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
  showInputRow('SAVE');
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
  if (groupName) {
    if (action === 'SAVE') {
      getCurrentTabs().then(tabs => saveNewGroup(groupName, tabs));
    } else if (action === 'CREATE') {
      saveNewGroup(groupName, []);
    } else if (action === 'RENAME') {
      const oldGroupName = inputAction.dataset.groupToRename;
      chrome.runtime.sendMessage({ action: 'renameGroup', oldGroupName: oldGroupName, newGroupName: groupName }, response => {
        if (response && response.status) {
          status.innerText = `Group renamed to "${groupName}"`;
          loadGroups();
        }
      });
    }
    inputRow.style.display = 'none';
    groupInput.value = '';
  }
});

function getCurrentTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, function(tabs) {
      const tabInfo = tabs.map(tab => ({ url: tab.url, title: tab.title }));
      resolve(tabInfo);
    });
  });
}

function saveNewGroup(groupName, tabs) {
  const color = getRandomColor();
  chrome.runtime.sendMessage({ action: 'saveSelectedTabs', groupName: groupName, tabs: tabs, color: color }, response => {
    if (response && response.status) {
      status.innerText = `Group "${groupName}" created`;
      loadGroups();
      updateActiveStatus();
    }
  });
}

function saveCurrentWindowToGroup(groupName) {
  getCurrentTabs().then(tabInfo => {
    chrome.runtime.sendMessage({ action: 'saveSelectedTabs', groupName: groupName, tabs: tabInfo }, response => {
      if (response && response.status) {
        status.innerText = `Group "${groupName}" updated`;
        loadGroups();
        updateActiveStatus();
      }
    });
  });
}

function loadGroups() {
  chrome.runtime.sendMessage({ action: 'getGroups' }, response => {
    if (!response || !response.groups) return;
    
    const groupContainer = document.getElementById('groupContainer');
    groupContainer.innerHTML = '';
    
    chrome.tabs.query({ currentWindow: true }, function(currentTabs) {
      const currentUrls = currentTabs.map(tab => tab.url);
      
      response.groups.forEach(group => {
        const groupRow = createGroupRow(group);
        
        if (group.tabs && group.tabs.length > 0) {
          const groupUrls = group.tabs.map(tab => tab.url);
          const isActive = currentUrls.length === groupUrls.length && 
                          currentUrls.every(url => groupUrls.includes(url));
          
          if (isActive) {
            groupRow.classList.add('active');
          }
        }
        
        groupContainer.appendChild(groupRow);
      });
    });
  });
}

function createGroupRow(group) {
  const groupRow = document.createElement('div');
  groupRow.className = 'group-row';
  groupRow.innerHTML = `
    <button class="group-name" style="background-color: ${group.color};">${group.name}</button>
    <button class="save">SAVE</button>
    <button class="copy">COPY</button>
    <button class="rename">RENAME</button>
    <button class="export">EXPORT</button>
    <button class="import">IMPORT</button>
    <button class="delete">DELETE</button>
  `;

  groupRow.querySelector('.group-name').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'restoreGroup', groupName: group.name }, response => {
      if (response && response.status) {
        status.innerText = response.status;
      }
    });
  });

  groupRow.querySelector('.save').addEventListener('click', () => {
    saveCurrentWindowToGroup(group.name);
  });

  groupRow.querySelector('.copy').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'copyGroupUrls', groupName: group.name }, response => {
      if (response && response.urls) {
        navigator.clipboard.writeText(response.urls.join('\n')).then(() => {
          status.innerText = `URLs from group "${group.name}" copied to clipboard`;
        });
      }
    });
  });

  groupRow.querySelector('.rename').addEventListener('click', () => {
    showInputRow('RENAME');
    inputAction.dataset.groupToRename = group.name;
  });

  groupRow.querySelector('.export').addEventListener('click', () => {
    exportGroup(group.name);
  });

  groupRow.querySelector('.import').addEventListener('click', () => {
    importGroup(group.name);
  });

  groupRow.querySelector('.delete').addEventListener('click', () => {
    if (confirm(`Are you sure you want to delete the group "${group.name}"?`)) {
      chrome.runtime.sendMessage({ action: 'deleteGroup', groupName: group.name }, response => {
        if (response && response.status) {
          status.innerText = response.status;
          loadGroups();
        }
      });
    }
  });

  return groupRow;
}

function updateActiveStatus() {
  chrome.tabs.query({ currentWindow: true }, function(currentTabs) {
    const currentUrls = currentTabs.map(tab => tab.url);
    
    document.querySelectorAll('.group-row').forEach(row => {
      const groupName = row.querySelector('.group-name').textContent;
      chrome.runtime.sendMessage({ action: 'getGroups' }, response => {
        if (!response || !response.groups) return;
        const group = response.groups.find(g => g.name === groupName);
        if (group && group.tabs) {
          const groupUrls = group.tabs.map(tab => tab.url);
          const isActive = currentUrls.length === groupUrls.length &&
                          currentUrls.every(url => groupUrls.includes(url));
          row.classList.toggle('active', isActive);
        }
      });
    });
  });
}

function getRandomColor() {
  const r = Math.floor(Math.random() * 128);
  const g = Math.floor(Math.random() * 128);
  const b = Math.floor(Math.random() * 128);
  return `rgb(${r},${g},${b})`;
}

document.addEventListener('DOMContentLoaded', () => {
  loadGroups();
  
  copyAll.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'copyAllGroupUrls' }, response => {
      if (response && response.urls) {
        navigator.clipboard.writeText(response.urls.join('\n')).then(() => {
          status.innerText = 'All group URLs copied to clipboard';
        });
      }
    });
  });

  exportAll.addEventListener('click', exportGroups);
  importAll.addEventListener('click', importGroups);
});

function exportGroups() {
  chrome.runtime.sendMessage({ action: 'exportAllGroups' }, response => {
    status.innerText = response && response.success ? 'All groups exported successfully' : 'Error exporting all groups';
    if (!response || !response.success) console.error('Export error:', response);
  });
}

function exportGroup(groupName) {
  chrome.runtime.sendMessage({ action: 'exportGroup', groupName: groupName }, response => {
    status.innerText = response && response.succe