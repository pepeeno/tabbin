console.log('popup.js loaded successfully');

const groupThese = document.getElementById('groupThese');
const copyThese = document.getElementById('copyThese');
const newGroup = document.getElementById('newGroup');
const inputRow = document.querySelector('.input-row');
const groupInput = document.getElementById('groupInput');
const inputAction = document.getElementById('inputAction');
const groupContainer = document.getElementById('groupContainer');
const copyAll = document.getElementById('copyAll');
const exportAll = document.getElementById('exportAll');
const importAll = document.getElementById('importAll');
const status = document.getElementById('status');

groupThese.addEventListener('click', () => {
    console.log('Group These button clicked');
    getCurrentTabs().then(tabs => {
        console.log('Current tabs:', tabs);
        if (tabs.length > 0) {
            showInputRow('SAVE');
            inputAction.dataset.action = 'groupThese';
            inputAction.dataset.tabs = JSON.stringify(tabs);
        } else {
            console.error('No tabs found in the current window');
            status.innerText = 'Error: No tabs found in the current window';
        }
    }).catch(error => {
        console.error('Error getting current tabs:', error);
        status.innerText = 'Error: Unable to get current tabs';
    });
});

copyThese.addEventListener('click', () => {
    chrome.tabs.query({ currentWindow: true }, function(tabs) {
        const tabUrls = tabs.map(tab => tab.url).join('\n');
        navigator.clipboard.writeText(tabUrls).then(() => {
            status.innerText = 'All tabs in current window copied to clipboard';
        });
    });
});

newGroup.addEventListener('click', () => {
    showInputRow('CREATE');
});

function showInputRow(action) {
    inputRow.style.display = 'flex';
    inputAction.textContent = action;
    groupInput.focus();
}

inputAction.addEventListener('click', () => {
    const action = inputAction.textContent;
    const groupName = groupInput.value;
    console.log('Input action clicked:', action, 'Group name:', groupName);
    if (groupName) {
        if (action === 'SAVE') {
            const tabsData = inputAction.dataset.tabs;
            if (tabsData) {
                const tabs = JSON.parse(tabsData);
                console.log('Tabs data for saving:', tabs);
                saveNewGroup(groupName, tabs);
            } else {
                console.error('No tabs data found for saving');
                status.innerText = 'Error: No tabs data found for saving';
            }
        } else if (action === 'CREATE') {
            saveNewGroup(groupName, []);
        } else if (action === 'RENAME') {
            // ... (rename logic remains the same)
        }
        inputRow.style.display = 'none';
        groupInput.value = '';
        delete inputAction.dataset.action;
        delete inputAction.dataset.tabs;
    }
});

function getCurrentTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ currentWindow: true }, function(tabs) {
            const tabInfo = tabs.map(tab => ({ 
                url: tab.url, 
                title: tab.title,
                favIconUrl: tab.favIconUrl
            }));
            console.log('Current tabs:', tabInfo);
            resolve(tabInfo);
        });
    });
}

function saveNewGroup(groupName, tabs) {
    console.log(`Attempting to save new group: ${groupName} with ${tabs.length} tabs`);
    console.log('Tabs:', tabs);
    chrome.runtime.sendMessage({ action: 'saveSelectedTabs', groupName: groupName, tabs: tabs }, response => {
        console.log('Save group response:', response);
        if (response) {
            if (response.success === false && response.error === 'A group with this name already exists') {
                const newName = prompt(`A group named "${groupName}" already exists. Please enter a different name:`);
                if (newName) {
                    saveNewGroup(newName, tabs);
                }
            } else if (response.success) {
                status.innerText = response.status;
                loadGroups(); // This will refresh the group list
            } else {
                status.innerText = `Error creating group "${groupName}": ${response.error || 'Unknown error'}`;
                console.error('Create group error:', response);
            }
        } else {
            status.innerText = `Error creating group "${groupName}": No response received`;
            console.error('Create group error: No response received');
        }
    });
}


function saveCurrentWindowToGroup(groupName) {
  getCurrentTabs().then(tabInfo => {
    chrome.runtime.sendMessage({ 
      action: 'saveSelectedTabs', 
      groupName: groupName, 
      tabs: tabInfo,
      isUpdate: true
    }, response => {
      if (response && response.success) {
        status.innerText = `${response.status} (${response.tabCount} tabs)`;
        highlightActiveGroup(); // Re-apply highlighting
        loadGroups();
      } else {
        status.innerText = `Error updating group "${groupName}"`;
        console.error('Update group error:', response);
      }
    });
  });
}

function createGroupRow(group) {
    const groupRow = document.createElement('div');
    groupRow.className = 'group-row';
    groupRow.dataset.groupName = group.name;
    groupRow.draggable = true;
    
    groupRow.innerHTML = `
        <button class="group-name" title="${group.name}">${group.name}</button>
        <div class="group-buttons">
            <button class="save" title="Save"></button>
            <button class="rename" title="Rename"></button>
            <button class="copy" title="Copy"></button>
            <button class="paste" title="Paste"></button>
            <button class="first" title="Move to First"></button>
            <button class="last" title="Move to Last"></button>
        </div>
        <div class="group-buttons-expanded">
            <button class="save" title="Save"></button>
            <button class="rename" title="Rename"></button>
            <button class="copy" title="Copy"></button>
            <button class="paste" title="Paste"></button>
            <button class="export" title="Export"></button>
            <button class="import" title="Import"></button>
            <button class="delete" title="Delete"></button>
        </div>
        <div class="tab-list" style="display: none;">
            <div class="tab-rows"></div>
            <div class="tab-actions">
                <p class="action-label">What to do with selected tabs:</p>
                <div class="action-buttons">
                    <button class="copy-selected" title="Copy URLs of selected tabs">COPY SELECTED</button>
                    <button class="open-selected" title="Open selected tabs">OPEN SELECTED</button>
                    <button class="delete-selected" title="Delete selected tabs">DELETE SELECTED</button>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for buttons
    const addButtonListener = (selector, action) => {
        const buttons = groupRow.querySelectorAll(selector);
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                action();
            });
        });
    };

    // Add listeners for all buttons
    addButtonListener('.save', () => saveCurrentWindowToGroup(group.name));
    addButtonListener('.rename', () => {
    const newName = prompt(`Enter new name for group "${group.name}":`);
    if (newName) {
        chrome.runtime.sendMessage({ action: 'renameGroup', oldGroupName: group.name, newGroupName: newName }, response => {
            if (response.success === false && response.error === 'A group with this name already exists') {
                alert(`A group named "${newName}" already exists. Please choose a different name.`);
            } else if (response.success) {
                status.innerText = `Group renamed to "${newName}"`;
                loadGroups(); // Refresh the group list immediately
            } else {
                status.innerText = `Error renaming group "${group.name}"`;
                console.error('Rename group error:', response);
            }
        });
    }
});

    addButtonListener('.copy', () => copyGroupUrls(group.name));
    addButtonListener('.paste', () => showPasteModal(group.name));
    addButtonListener('.first', () => moveGroup(group.name, 'first'));
    addButtonListener('.last', () => moveGroup(group.name, 'last'));
    addButtonListener('.export', () => exportGroup(group.name));
    addButtonListener('.import', () => importGroup(group.name));
    addButtonListener('.delete', () => {
        if (confirm(`Are you sure you want to delete the group "${group.name}"?`)) {
            chrome.runtime.sendMessage({ action: 'deleteGroup', groupName: group.name }, response => {
                if (response && response.success) {
                    status.innerText = `Group "${group.name}" deleted successfully`;
                    loadGroups(); // Refresh the group list
                } else {
                    status.innerText = `Error deleting group "${group.name}"`;
                    console.error('Delete group error:', response);
                }
            });
        }
    });

    groupRow.querySelector('.group-name').addEventListener('click', (event) => {
        if (event.ctrlKey || event.button === 1) {
            // Open in new window
            chrome.runtime.sendMessage({ action: 'restoreGroup', groupName: group.name, newWindow: true }, response => {
                status.innerText = response && response.status ? response.status : `Error restoring group "${group.name}"`;
                if (!response || !response.status) console.error('Restore error:', response);
            });
        } else {
            // Toggle expanded buttons and tab list
            const expandedButtons = groupRow.querySelector('.group-buttons-expanded');
            const normalButtons = groupRow.querySelector('.group-buttons');
            const tabList = groupRow.querySelector('.tab-list');

            if (expandedButtons.style.display === 'none' || expandedButtons.style.display === '') {
                expandedButtons.style.display = 'flex';
                normalButtons.style.display = 'none';
                tabList.style.display = 'block';
                loadTabsForGroup(group.name, tabList);
            } else {
                expandedButtons.style.display = 'none';
                if (groupRow.matches(':hover')) {
                    normalButtons.style.display = 'flex';
                }
                tabList.style.display = 'none';
            }
        }
    });

    // Handle middle-click and ctrl+click
    groupRow.querySelector('.group-name').addEventListener('mouseup', (event) => {
        if (event.button === 1) {
            chrome.runtime.sendMessage({ action: 'restoreGroup', groupName: group.name, newWindow: true }, response => {
                status.innerText = response && response.status ? response.status : `Error restoring group "${group.name}"`;
                if (!response || !response.status) console.error('Restore error:', response);
            });
        }
    });

    // Show normal buttons on hover
    groupRow.addEventListener('mouseenter', () => {
        const expandedButtons = groupRow.querySelector('.group-buttons-expanded');
        const normalButtons = groupRow.querySelector('.group-buttons');
        if (expandedButtons.style.display !== 'flex') {
            normalButtons.style.display = 'flex';
        }
    });

    groupRow.addEventListener('mouseleave', () => {
        const expandedButtons = groupRow.querySelector('.group-buttons-expanded');
        const normalButtons = groupRow.querySelector('.group-buttons');
        if (expandedButtons.style.display !== 'flex') {
            normalButtons.style.display = 'none';
        }
    });

    return groupRow;
}

function getRandomColor() {
    const r = Math.floor(Math.random() * 128);
    const g = Math.floor(Math.random() * 128);
    const b = Math.floor(Math.random() * 128);
    return `rgb(${r},${g},${b})`;
}

function exportGroup(groupName) {
    chrome.runtime.sendMessage({ action: 'exportGroup', groupName: groupName }, response => {
        if (response && response.success) {
            chrome.downloads.download({
                url: response.dataUrl,
                filename: response.filename,
                saveAs: true
            }, () => {
                status.innerText = `Group "${groupName}" exported successfully`;
            });
        } else {
            status.innerText = `Error exporting group "${groupName}"`;
            console.error('Export error:', response);
        }
    });
}

function importGroup(groupName) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = event => {
            const contents = event.target.result;
            chrome.runtime.sendMessage({ 
                action: 'importGroup', 
                groupName: groupName, 
                data: contents 
            }, response => {
                if (response && response.success) {
                    status.innerText = `Group "${groupName}" imported successfully`;
                    loadGroups(); // Refresh the group list
                } else {
                    status.innerText = `Error importing group "${groupName}"`;
                    console.error('Import error:', response);
                }
            });
        };
        reader.readAsText(file);
    };
    input.click();
}

function exportGroups() {
    chrome.runtime.sendMessage({ action: 'exportAllGroups' }, response => {
        status.innerText = response && response.success ? 'All groups exported successfully' : 'Error exporting all groups';
        if (!response || !response.success) console.error('Export error:', response);
    });
}

function importGroups() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = event => {
            const contents = event.target.result;
            chrome.runtime.sendMessage({ action: 'importGroups', data: contents }, response => {
                status.innerText = response && response.success ? 'Groups imported successfully' : 'Error importing groups';
                if (response && response.success) loadGroups();
                else console.error('Import error:', response);
            });
        };
        reader.readAsText(file);
    };
    input.click();
}


function adjustPopupHeight() {
    const container = document.querySelector('.container');
    const fixedSections = document.querySelectorAll('.fixed-section');
    const scrollableSection = document.querySelector('.scrollable-section');
    
    let totalFixedHeight = Array.from(fixedSections).reduce((sum, section) => sum + section.offsetHeight, 0);
    let availableHeight = window.innerHeight - totalFixedHeight;
    
    // Ensure the scrollable section has a minimum height of 400px
    scrollableSection.style.height = `${Math.max(400, Math.min(availableHeight, 700))}px`;
    
    // Adjust the container height to accommodate the new scrollable section height
    container.style.height = `${Math.max(totalFixedHeight + 400, Math.min(totalFixedHeight + scrollableSection.offsetHeight, 1000))}px`;
}

function loadGroups() {
    console.log('Loading groups...');
    chrome.runtime.sendMessage({ action: 'getGroups' }, response => {
        console.log('Loaded groups:', response.groups);
        if (response && response.groups) {
            groupContainer.innerHTML = '';
            response.groups.forEach(group => {
                const groupRow = createGroupRow(group);
                if (groupRow instanceof Node) {
                    groupContainer.appendChild(groupRow);
                } else {
                    console.error('createGroupRow did not return a valid Node:', groupRow);
                }
            });
            initDragAndDrop();
            adjustPopupHeight();
        } else {
            console.error('Error loading groups:', response);
            status.innerText = 'Error loading groups';
        }
    });
}

document.addEventListener('DOMContentLoaded', adjustPopupHeight);
window.addEventListener('resize', adjustPopupHeight);

function moveGroup(groupName, direction) {
    chrome.runtime.sendMessage({ action: 'moveGroup', groupName: groupName, direction: direction }, response => {
        if (response && response.success) {
            loadGroups();
        } else {
            status.innerText = `Error moving group "${groupName}"`;
            console.error('Move group error:', response);
        }
    });
}

function toggleTabList(groupRow, groupName) {
    const tabList = groupRow.querySelector('.tab-list');
    console.log('Toggling tab list for group:', groupName);
    console.log('Current display state:', tabList.style.display);
    if (tabList.style.display === 'none') {
        loadTabsForGroup(groupName, tabList);
        tabList.style.display = 'block';
    } else {
        tabList.style.display = 'none';
    }
    console.log('New display state:', tabList.style.display);
}

function createTabRow(tab, groupName) {
    console.log('Creating tab row for:', tab);
    const tabRow = document.createElement('div');
    tabRow.className = 'tab-row';
    
    // Use Google's favicon service as a fallback
    const faviconSrc = tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}`;
    console.log('Favicon source:', faviconSrc);

    tabRow.innerHTML = `
        <input type="checkbox" class="tab-checkbox">
        <img class="tab-favicon" src="${faviconSrc}" alt="Favicon" onerror="this.src='${chrome.runtime.getURL('icons/default-favicon.png')}';">
        <span class="tab-title" title="${tab.title}">${tab.title}</span>
        <button class="tab-copy" title="Copy URL"></button>
        <button class="tab-open" title="Open tab"></button>
        <button class="tab-delete" title="Delete tab"></button>
    `;

    tabRow.querySelector('.tab-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(tab.url).then(() => {
            status.innerText = `Copied URL: ${tab.url}`;
        }).catch(err => {
            console.error('Failed to copy URL:', err);
            status.innerText = 'Failed to copy URL';
        });
    });

    tabRow.querySelector('.tab-open').addEventListener('click', () => {
        chrome.tabs.create({ url: tab.url });
    });

    tabRow.querySelector('.tab-delete').addEventListener('click', () => {
        deleteTab(tab.title, groupName);
    });

    return tabRow;
}

function setupTabActions(tabList, groupName) {
    const copySelectedButton = tabList.querySelector('.copy-selected');
    const openSelectedButton = tabList.querySelector('.open-selected');
    const deleteSelectedButton = tabList.querySelector('.delete-selected');

    if (copySelectedButton) {
        copySelectedButton.addEventListener('click', () => {
            const selectedTabs = getSelectedTabs(tabList);
            copySelectedUrls(groupName, selectedTabs);
        });
    }

    if (openSelectedButton) {
        openSelectedButton.addEventListener('click', () => {
            const selectedTabs = getSelectedTabs(tabList);
            openSelectedTabs(groupName, selectedTabs);
        });
    }

    if (deleteSelectedButton) {
        deleteSelectedButton.addEventListener('click', () => {
            const selectedTabs = getSelectedTabs(tabList);
            deleteSelectedTabs(groupName, selectedTabs);
        });
    }
}

function getSelectedTabs(tabList) {
    return Array.from(tabList.querySelectorAll('.tab-checkbox:checked'))
        .map(checkbox => checkbox.closest('.tab-row').querySelector('.tab-title').textContent);
}

function openSelectedTabs(groupName, selectedTabs) {
    console.log(`Attempting to open tabs from group "${groupName}":`, selectedTabs);
    chrome.runtime.sendMessage({ action: 'openSelectedTabs', groupName: groupName, selectedTabs: selectedTabs }, response => {
        console.log('Open selected tabs response:', response);
        if (response && response.success) {
            status.innerText = `Opened ${selectedTabs.length} tab(s) from group "${groupName}"`;
        } else {
            status.innerText = `Error opening tabs from group "${groupName}"`;
            console.error('Open tabs error:', response);
        }
    });
}

function copySelectedUrls(groupName, selectedTabs) {
    console.log(`Attempting to copy URLs from group "${groupName}":`, selectedTabs);
    chrome.runtime.sendMessage({ action: 'getSelectedUrls', groupName: groupName, selectedTabs: selectedTabs }, response => {
        console.log('Get selected URLs response:', response);
        if (response && response.urls && response.urls.length > 0) {
            navigator.clipboard.writeText(response.urls.join('\n')).then(() => {
                status.innerText = `Copied ${response.urls.length} URL(s) from group "${groupName}"`;
            }).catch(err => {
                status.innerText = `Error copying URLs to clipboard`;
                console.error('Clipboard error:', err);
            });
        } else {
            status.innerText = `Error copying URLs from group "${groupName}"`;
            console.error('Copy URLs error:', response);
        }
    });
}

function loadTabsForGroup(groupName, tabList) {
    console.log('Loading tabs for group:', groupName);
    if (!tabList) {
        console.error('tabList is null for group:', groupName);
        return;
    }
    chrome.runtime.sendMessage({ action: 'getGroupTabs', groupName: groupName }, response => {
        console.log('Received tabs:', response);
        if (response && response.tabs && response.tabs.length > 0) {
            const tabRows = tabList.querySelector('.tab-rows');
            if (!tabRows) {
                console.error('tabRows not found in tabList for group:', groupName);
                return;
            }
            tabRows.innerHTML = ''; // Clear existing rows
            response.tabs.forEach(tab => {
                console.log('Tab data:', tab);
                const tabRow = createTabRow(tab, groupName);
                tabRows.appendChild(tabRow);
            });
            console.log(`Created ${response.tabs.length} tab rows`);
            setupTabActions(tabList, groupName);
        } else {
            console.log(`No tabs found for group: ${groupName}`);
            tabList.innerHTML = '<p>No tabs in this group</p>';
        }
    });
}

function deleteTab(tabTitle, groupName) {
    const groupRow = document.querySelector(`[data-group-name="${groupName}"]`);
    if (!groupRow) {
        console.error('Group row not found for:', groupName);
        return;
    }
    const tabList = groupRow.querySelector('.tab-list');
    if (!tabList) {
        console.error('Tab list not found for group:', groupName);
        return;
    }

    chrome.runtime.sendMessage({ action: 'deleteTab', tabId: tabTitle, groupName: groupName }, response => {
        if (response && response.success) {
            loadTabsForGroup(groupName, tabList);
            status.innerText = `Tab deleted from group "${groupName}"`;
        } else {
            status.innerText = `Error deleting tab from group "${groupName}"`;
            console.error('Delete tab error:', response);
        }
    });
}

function deleteSelectedTabs(groupName, selectedTabs) {
    console.log(`Attempting to delete tabs from group "${groupName}":`, selectedTabs);
    if (selectedTabs.length === 0) {
        status.innerText = 'No tabs selected for deletion';
        return;
    }

    chrome.runtime.sendMessage({ action: 'deleteSelectedTabs', groupName: groupName, selectedTabs: selectedTabs }, response => {
        console.log('Delete selected tabs response:', response);
        if (response && response.success) {
            status.innerText = `Deleted ${selectedTabs.length} tab(s) from group "${groupName}"`;
            loadTabsForGroup(groupName, document.querySelector(`[data-group-name="${groupName}"] .tab-list`));
        } else {
            status.innerText = `Error deleting tabs from group "${groupName}"`;
            console.error('Delete tabs error:', response);
        }
    });
}

function initDragAndDrop() {
    const container = document.getElementById('groupContainer');

    container.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('group-row')) {
            e.target.classList.add('dragging');
            e.dataTransfer.setData('text/plain', e.target.dataset.groupName);
        }
    });

    container.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('group-row')) {
            e.target.classList.remove('dragging');
        }
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingElement = container.querySelector('.dragging');
        const closestElement = getClosestElement(container, e.clientY);
        if (closestElement) {
            container.insertBefore(draggingElement, closestElement);
        } else {
            container.appendChild(draggingElement);
        }
    });

    container.addEventListener('dragenter', (e) => {
        if (e.target.classList.contains('group-row') && !e.target.classList.contains('dragging')) {
            e.target.classList.add('drag-over');
        }
    });

    container.addEventListener('dragleave', (e) => {
        if (e.target.classList.contains('group-row')) {
            e.target.classList.remove('drag-over');
        }
    });

container.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedGroupName = e.dataTransfer.getData('text/plain');
    const targetElement = e.target.closest('.group-row');
    
    if (targetElement) {
        const targetGroupName = targetElement.dataset.groupName;
        if (draggedGroupName !== targetGroupName) {
            reorderGroups(draggedGroupName, targetGroupName);
        }
    } else {
        console.log('Drop target is not a group row');
    }
    
    document.querySelectorAll('.group-row').forEach(row => row.classList.remove('drag-over'));
});
}

function getClosestElement(container, y) {
    const elements = [...container.querySelectorAll('.group-row:not(.dragging)')];
    return elements.reduce((closest, element) => {
        const box = element.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: element };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function reorderGroups(draggedGroupName, targetGroupName) {
    chrome.runtime.sendMessage({ 
        action: 'reorderGroups', 
        draggedGroupName: draggedGroupName, 
        targetGroupName: targetGroupName 
    }, response => {
        if (response && response.success) {
            // Update the order locally
            const container = document.getElementById('groupContainer');
            const draggedElement = container.querySelector(`[data-group-name="${draggedGroupName}"]`);
            const targetElement = container.querySelector(`[data-group-name="${targetGroupName}"]`);
            if (draggedElement && targetElement) {
                container.insertBefore(draggedElement, targetElement);
            }
            // Refresh the groups to ensure order is saved
            loadGroups();
        } else {
            console.error('Error reordering groups:', response);
            status.innerText = 'Error reordering groups';
            loadGroups();
        }
    });
}

// Call this function after loading groups
function loadGroups() {
    console.log('Loading groups...'); // Add this line for debugging
    chrome.runtime.sendMessage({ action: 'getGroups' }, response => {
        if (response && response.groups) {
            groupContainer.innerHTML = '';
            response.groups.forEach(group => {
                const groupRow = createGroupRow(group);
                groupContainer.appendChild(groupRow);
            });
            initDragAndDrop(); // Initialize drag-and-drop after loading groups
            adjustPopupHeight();
        } else {
            console.error('Error loading groups:', response);
            status.innerText = 'Error loading groups';
        }
    });
}

function initDragAndDrop() {
    const container = document.getElementById('groupContainer');
    let draggedElement = null;

    container.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('group-row')) {
            draggedElement = e.target;
            e.dataTransfer.setData('text/plain', e.target.dataset.groupName);
            e.target.classList.add('dragging');
        }
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(container, e.clientY);
        if (draggedElement && afterElement !== draggedElement) {
            if (afterElement == null) {
                container.appendChild(draggedElement);
            } else {
                container.insertBefore(draggedElement, afterElement);
            }
        }
    });

    container.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('group-row')) {
            e.target.classList.remove('dragging');
            updateGroupOrder();
        }
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.group-row:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateGroupOrder() {
    const groupRows = document.querySelectorAll('.group-row');
    const newOrder = Array.from(groupRows).map(row => row.dataset.groupName);
    
    console.log('Updating group order:', newOrder);
    chrome.runtime.sendMessage({ action: 'reorderGroups', newOrder: newOrder }, response => {
        console.log('Received response from reorderGroups:', response);
        if (response && response.success) {
            console.log('Group order updated successfully');
            loadGroups(); // Refresh the groups to ensure order is saved
        } else {
            console.error('Error reordering groups:', response ? response.error : 'Unknown error');
            status.innerText = 'Error reordering groups';
            loadGroups(); // Reload groups to reset the order
        }
    });
}

function copyGroupUrls(groupName) {
    chrome.runtime.sendMessage({ action: 'copyGroupUrls', groupName: groupName }, response => {
        if (response && response.urls && response.urls.length > 0) {
            navigator.clipboard.writeText(response.urls.join('\n')).then(() => {
                updateStatus(`URLs from group "${groupName}" copied to clipboard`);
            }).catch(err => {
                updateStatus(`Error copying URLs to clipboard`);
                console.error('Clipboard error:', err);
            });
        } else {
            updateStatus(`Error copying URLs from group "${groupName}"`);
            console.error('Copy error:', response);
        }
    });
}

function updateStatus(message) {
    if (status) {
        status.innerText = message;
    } else {
        console.log('Status update:', message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadGroups();
    adjustPopupHeight();
    highlightActiveGroup();
    console.log('DOM content loaded, calling highlightActiveGroup');

    copyAll.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'copyAllGroupUrls' }, response => {
            if (response.success) {
                navigator.clipboard.writeText(response.urls.join('\n')).then(() => {
                    updateStatus('All group URLs copied to clipboard');
                }).catch(err => {
                    updateStatus('Error copying URLs to clipboard');
                    console.error('Clipboard error:', err);
                });
            } else {
                updateStatus('Error copying all group URLs');
                console.error('Copy all URLs error:', response);
            }
        });
    });

    exportAll.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'exportAllGroups' }, response => {
            if (response.success) {
                updateStatus('All groups exported successfully');
            } else {
                updateStatus('Error exporting all groups');
                console.error('Export error:', response);
            }
        });
    });

    importAll.addEventListener('click', () => {
        if (confirm('Importing will overwrite all existing groups. Are you sure you want to continue?')) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = e => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = event => {
                    const contents = event.target.result;
                    chrome.runtime.sendMessage({ action: 'importGroups', data: contents }, response => {
                        if (response.success) {
                            updateStatus('Groups imported successfully');
                            loadGroups();
                        } else {
                            updateStatus('Error importing groups');
                            console.error('Import error:', response);
                        }
                    });
                };
                reader.readAsText(file);
            };
            input.click();
        }
    });
});

window.addEventListener('focus', () => {
  console.log('Popup window focused');
  highlightActiveGroup();
});

function showPasteModal(groupName) {
    const modal = document.getElementById('pasteModal');
    const textarea = document.getElementById('urlTextarea');
    const addButton = document.getElementById('addUrlsButton');
    const cancelButton = document.getElementById('cancelPasteButton');

    modal.style.display = 'block';
    textarea.value = '';

    addButton.onclick = () => {
        const urls = textarea.value.split('\n').filter(url => url.trim() !== '');
        const option = document.querySelector('input[name="pasteOption"]:checked').value;
        
        chrome.runtime.sendMessage({ 
            action: 'addUrlsToGroup', 
            groupName: groupName, 
            urls: urls, 
            option: option 
        }, response => {
            if (response.success) {
                status.innerText = `Added ${urls.length} URL(s) to group "${groupName}". Fetching titles...`;
                setTimeout(() => {
                    loadGroups(); // Refresh the group list after a short delay
                    status.innerText = `Added ${urls.length} URL(s) to group "${groupName}" and updated titles.`;
                }, 2000);
            } else {
                status.innerText = `Error adding URLs to group "${groupName}"`;
                console.error('Add URLs error:', response);
            }
        });
        modal.style.display = 'none';
    };

    cancelButton.onclick = () => {
        modal.style.display = 'none';
    };
}

function addUrlsToGroup(groupName, urls, option) {
    chrome.runtime.sendMessage({ 
        action: 'addUrlsToGroup', 
        groupName: groupName, 
        urls: urls, 
        option: option 
    }, response => {
        if (response.success) {
            status.innerText = `Added ${urls.length} URL(s) to group "${groupName}"`;
            loadGroups(); // Refresh the group list
        } else {
            status.innerText = `Error adding URLs to group "${groupName}"`;
            console.error('Add URLs error:', response);
        }
    });
}

function highlightActiveGroup() {
  console.log('highlightActiveGroup called');
  chrome.windows.getCurrent({populate: true}, (window) => {
    console.log('Current window:', window.id);
    chrome.runtime.sendMessage({action: 'getActiveGroup', windowId: window.id}, (response) => {
      console.log('getActiveGroup response:', response);
      if (response && response.groupName) {
        console.log('Active group found:', response.groupName);
        const groupRows = document.querySelectorAll('.group-row');
        console.log('Number of group rows:', groupRows.length);
        let foundMatch = false;
        groupRows.forEach(row => {
          const groupNameElement = row.querySelector('.group-name');
          const groupName = groupNameElement ? groupNameElement.textContent.trim() : null;
          console.log('Checking group:', groupName);
          if (groupName === response.groupName) {
            console.log('Match found, highlighting:', groupName);
            row.style.border = '2px solid yellow';
            foundMatch = true;
          } else {
            row.style.border = 'none';
          }
        });
        if (!foundMatch) {
          console.log('No matching group found in UI for:', response.groupName);
        }
      } else {
        console.log('No active group found for this window');
        document.querySelectorAll('.group-row').forEach(row => {
          row.style.border = 'none';
        });
      }
    });
  });
}

window.addEventListener('focus', () => {
    console.log('Popup window focused, calling highlightActiveGroup');
    highlightActiveGroup();
});

chrome.tabs.onActivated.addListener(() => {
    console.log('Tab activated, calling highlightActiveGroup');
    highlightActiveGroup();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        console.log('Window focus changed, calling highlightActiveGroup');
        highlightActiveGroup();
    }
});

// Add these to your popup.js file
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM content loaded, calling highlightActiveGroup');
  highlightActiveGroup();
});

window.addEventListener('focus', () => {
  console.log('Popup window focused, calling highlightActiveGroup');
  highlightActiveGroup();
});

chrome.tabs.onActivated.addListener(() => {
  console.log('Tab activated, calling highlightActiveGroup');
  highlightActiveGroup();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    console.log('Window focus changed, calling highlightActiveGroup');
    highlightActiveGroup();
  }
});

