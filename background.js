let windowGroupMap = {};

chrome.runtime.onInstalled.addListener(() => {
  console.log('Tabbin installed');
  windowGroupMap = {}; // Reset the map on installation
});

const MAX_CHUNK_SIZE = 8000; // Just under the 8KB limit

const DEFAULT_GROUP_COLOR = '#434343';

const saveTabsToGroup = (groupName, tabs, sendResponse, isUpdate = false) => {
    console.log(`Attempting to ${isUpdate ? 'update' : 'save'} group: ${groupName}`);
    console.log('Tabs received:', tabs);
    console.log('Tabs length:', tabs ? tabs.length : 'undefined');

    if (!Array.isArray(tabs)) {
        console.error('Tabs is not an array');
        try {
            sendResponse({ success: false, error: 'Invalid tabs data' });
        } catch (error) {
            console.error('Error sending response:', error);
        }
        return true;
    }

    chrome.storage.sync.get('groups', function(data) {
        let groups = data.groups || [];
        console.log('Existing groups:', groups);

        const groupIndex = groups.findIndex(group => group.name === groupName);
        console.log('Group index:', groupIndex);

        if (groupIndex !== -1) {
            if (!isUpdate) {
                console.log('Group already exists, sending error response');
                try {
                    sendResponse({ success: false, error: 'A group with this name already exists' });
                } catch (error) {
                    console.error('Error sending response:', error);
                }
                return;
            } else {
                console.log('Updating existing group');
                groups[groupIndex].tabCount = tabs.length;
            }
        } else {
            if (isUpdate) {
                console.log('Group not found for update, sending error response');
                try {
                    sendResponse({ success: false, error: 'Group not found for update' });
                } catch (error) {
                    console.error('Error sending response:', error);
                }
                return;
            }
            console.log('Creating new group');
            groups.push({
                name: groupName,
                tabCount: tabs.length
            });
        }

        chrome.storage.sync.set({ groups: groups }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error saving groups:', chrome.runtime.lastError);
                try {
                    sendResponse({ success: false, error: `Error ${isUpdate ? 'updating' : 'saving'} group "${groupName}"` });
                } catch (error) {
                    console.error('Error sending response:', error);
                }
                return;
            }

            console.log(`Groups list updated in sync storage`);
            
            // Save tabs in chunks
            const chunks = [];
            let currentChunk = [];
            let currentSize = 0;
            const MAX_CHUNK_SIZE = 8000; // Adjust if needed

            tabs.forEach((tab) => {
                const tabString = JSON.stringify(tab);
                if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                    currentSize = 0;
                }
                currentChunk.push(tab);
                currentSize += tabString.length;
            });

            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }

            console.log(`Created ${chunks.length} chunks for group ${groupName}`);

            // Clear existing chunks before saving new ones
            chrome.storage.local.get(null, function(localData) {
                const deletePromises = Object.keys(localData)
                    .filter(key => key.startsWith(`${groupName}_chunk_`))
                    .map(key => new Promise(resolve => chrome.storage.local.remove(key, resolve)));

                Promise.all(deletePromises).then(() => {
                    const saveChunks = (index) => {
                        if (index >= chunks.length) {
                            try {
                                sendResponse({ success: true, status: `Group "${groupName}" ${isUpdate ? 'updated' : 'created'}`, tabCount: tabs.length });
                            } catch (error) {
                                console.error('Error sending response:', error);
                            }
                            return;
                        }

                        chrome.storage.local.set({ [`${groupName}_chunk_${index}`]: chunks[index] }, () => {
                            if (chrome.runtime.lastError) {
                                console.error(`Error saving chunk ${index}:`, chrome.runtime.lastError);
                                try {
                                    sendResponse({ success: false, error: `Error ${isUpdate ? 'updating' : 'saving'} group "${groupName}"` });
                                } catch (error) {
                                    console.error('Error sending response:', error);
                                }
                            } else {
                                console.log(`Chunk ${index} saved for group ${groupName}`);
                                saveChunks(index + 1);
                            }
                        });
                    };

                    saveChunks(0);
                });
            });
        });
    });
    return true; // Indicates that the response is sent asynchronously
};

const restoreTabsFromGroup = (groupName, newWindow = false) => {
  console.log(`Restoring tabs from group: ${groupName}, newWindow: ${newWindow}`);
  chrome.storage.sync.get('groups', function(data) {
    const groups = data.groups || [];
    const group = groups.find(group => group.name === groupName);
    if (group) {
      chrome.storage.local.get(null, function(localData) {
        const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
        const tabsToRestore = chunkKeys.sort().flatMap(key => localData[key]);
        console.log(`Found ${tabsToRestore.length} tabs for group ${groupName}`);
        if (tabsToRestore && tabsToRestore.length > 0) {
          if (newWindow) {
            chrome.windows.create({ url: tabsToRestore[0].url }, (newWindow) => {
              tabsToRestore.slice(1).forEach(tab => {
                chrome.tabs.create({ windowId: newWindow.id, url: tab.url });
              });
              setWindowGroup(newWindow.id, groupName).then(() => {
                console.log(`Group ${groupName} set for new window ${newWindow.id}`);
              });
            });
          } else {
            chrome.windows.getCurrent({}, (currentWindow) => {
              tabsToRestore.forEach(tab => {
                chrome.tabs.create({ windowId: currentWindow.id, url: tab.url });
              });
              setWindowGroup(currentWindow.id, groupName).then(() => {
                console.log(`Group ${groupName} set for current window ${currentWindow.id}`);
              });
            });
          }
        } else {
          console.log(`No tabs found for group ${groupName}`);
        }
      });
    } else {
      console.log(`Group ${groupName} not found`);
    }
  });
};

chrome.windows.onRemoved.addListener((windowId) => {
  console.log(`Window ${windowId} removed`);
  chrome.storage.local.get(['windowGroupMap'], (result) => {
    const map = result.windowGroupMap || {};
    delete map[windowId];
    chrome.storage.local.set({windowGroupMap: map}, () => {
      console.log('Window group map updated after window removal:');
      logWindowGroupMap();
    });
  });
});

const loadTabsFromStorage = (groupName, storageType) => {
  const storage = storageType === 'sync' ? chrome.storage.sync : chrome.storage.local;
  storage.get(null, function(data) {
    const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${groupName}_chunk_`));
    const tabs = chunkKeys.sort().flatMap(key => data[key]);
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.create({ url: tab.url });
      });
      console.log(`Tabs restored from group ${groupName}`);
    } else {
      console.log(`No tabs in group ${groupName}`);
    }
  });
};

const deleteGroup = (groupName, sendResponse) => {
    chrome.storage.sync.get(null, function(data) {
        let groups = data.groups || [];
        const initialLength = groups.length;
        groups = groups.filter(group => group.name !== groupName);

        if (groups.length === initialLength) {
            console.log(`Group ${groupName} not found`);
            sendResponse({success: false, error: 'Group not found'});
            return;
        }

        const deleteOperations = [];

        // Delete the group from the groups list
        deleteOperations.push(new Promise((resolve) => {
            chrome.storage.sync.set({ groups: groups }, resolve);
        }));

        // Delete all chunks associated with this group
        const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${groupName}_chunk_`));
        chunkKeys.forEach(key => {
            deleteOperations.push(new Promise((resolve) => {
                chrome.storage.sync.remove(key, resolve);
            }));
        });

        Promise.all(deleteOperations).then(() => {
            console.log(`Group ${groupName} deleted successfully`);
            sendResponse({success: true});
        }).catch((error) => {
            console.error('Error deleting group:', error);
            sendResponse({success: false, error: 'Error deleting group'});
        });
    });
    return true; // Keeps the message channel open for asynchronous response
};

const renameGroup = (oldGroupName, newGroupName, sendResponse) => {
  chrome.storage.sync.get('groups', function(data) {
    let groups = data.groups || [];
    const groupIndex = groups.findIndex(group => group.name === oldGroupName);
    if (groupIndex !== -1) {
      // Check if the new name already exists
      if (groups.some(group => group.name === newGroupName)) {
        sendResponse({ success: false, error: 'A group with this name already exists' });
        return;
      }

      groups[groupIndex].name = newGroupName;
      chrome.storage.sync.set({ groups: groups }, () => {
        // Rename chunk keys in local storage
        chrome.storage.local.get(null, function(localData) {
          const updatePromises = Object.keys(localData)
            .filter(key => key.startsWith(`${oldGroupName}_chunk_`))
            .map(oldKey => {
              const newKey = oldKey.replace(oldGroupName, newGroupName);
              return new Promise(resolve => {
                chrome.storage.local.set({ [newKey]: localData[oldKey] }, () => {
                  chrome.storage.local.remove(oldKey, resolve);
                });
              });
            });

          Promise.all(updatePromises).then(() => {
            console.log(`Group renamed from ${oldGroupName} to ${newGroupName}`);
            sendResponse({ success: true });
          }).catch(error => {
            console.error('Error renaming group chunks:', error);
            sendResponse({ success: false, error: 'Error renaming group chunks' });
          });
        });
      });
    } else {
      sendResponse({ success: false, error: 'Group not found' });
    }
  });
  return true; // Indicates that the response is sent asynchronously
};

const copyGroupUrls = (groupName, sendResponse) => {
    chrome.storage.local.get(null, function(data) {
        const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${groupName}_chunk_`));
        const tabs = chunkKeys.sort().flatMap(key => data[key]);
        if (tabs.length > 0) {
            const urls = tabs.map(tab => tab.url);
            sendResponse({ urls: urls });
        } else {
            console.error('No tabs found for group:', groupName);
            sendResponse({ urls: [], error: 'No tabs found in group' });
        }
    });
};

function copyAllGroupUrls(sendResponse) {
  chrome.storage.sync.get('groups', function(data) {
    const groups = data.groups || [];
    let allUrls = [];
    let processedGroups = 0;

    const processGroup = (index) => {
      if (index >= groups.length) {
        sendResponse({ success: true, urls: allUrls });
        return;
      }

      const group = groups[index];
      chrome.storage.local.get(null, function(localData) {
        const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${group.name}_chunk_`));
        const tabs = chunkKeys.sort().flatMap(key => localData[key]);
        
        // Add a blank line before each group (except the first one)
        if (allUrls.length > 0) {
          allUrls.push('');
        }
        
        // Add the group name
        allUrls.push(`Group: ${group.name}`);
        
        // Add the URLs
        allUrls = allUrls.concat(tabs.map(tab => tab.url));
        
        processGroup(index + 1);
      });
    };

    processGroup(0);
  });
  return true; // Indicates that the response is sent asynchronously
}

function exportAllGroups(sendResponse) {
  chrome.storage.sync.get('groups', function(data) {
    const groups = data.groups || [];
    let exportData = [];
    let processedGroups = 0;

    const processGroup = (index) => {
      if (index >= groups.length) {
        const jsonString = JSON.stringify(exportData, null, 2);
        const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
        
        chrome.downloads.download({
          url: dataUrl,
          filename: 'tabbin_all_groups.json',
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Download error:', chrome.runtime.lastError);
            sendResponse({success: false, error: chrome.runtime.lastError.message});
          } else {
            console.log('All groups exported successfully');
            sendResponse({success: true});
          }
        });
        return;
      }

      const group = groups[index];
      chrome.storage.local.get(null, function(localData) {
        const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${group.name}_chunk_`));
        const tabs = chunkKeys.sort().flatMap(key => localData[key]);
        
        exportData.push({
          name: group.name,
          color: group.color,
          tabs: tabs,
          order: group.order // Include the order in the exported data
        });
        
        processGroup(index + 1);
      });
    };

    processGroup(0);
  });
  return true; // Indicates that the response is sent asynchronously
}

function importGroups(data, sendResponse) {
  try {
    const importedGroups = JSON.parse(data);
    console.log('Parsed imported groups:', importedGroups);

    chrome.storage.sync.get('groups', function(storageData) {
      let existingGroups = storageData.groups || [];

      const saveOperations = [];

      // Create a map of existing groups for easy lookup
      const existingGroupMap = new Map(existingGroups.map(g => [g.name, g]));

      // Process imported groups, preserving their order
      importedGroups.forEach((importedGroup, index) => {
        const groupName = importedGroup.name;
        const tabs = importedGroup.tabs || [];
        const color = importedGroup.color || getRandomColor();
        const order = index; // Use the index as the order

        // Update or add the group info
        if (existingGroupMap.has(groupName)) {
          const existingGroup = existingGroupMap.get(groupName);
          existingGroup.color = color;
          existingGroup.tabCount = tabs.length;
          existingGroup.order = order;
        } else {
          existingGroups.push({ name: groupName, color: color, tabCount: tabs.length, order: order });
        }

        // Split tabs into chunks and save
        const MAX_CHUNK_SIZE = 8000;
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;

        tabs.forEach((tab) => {
          const tabString = JSON.stringify(tab);
          if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentSize = 0;
          }
          currentChunk.push(tab);
          currentSize += tabString.length;
        });
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
        }

        // Save chunks
        chunks.forEach((chunk, chunkIndex) => {
          saveOperations.push(new Promise((resolve) => {
            chrome.storage.local.set({ [`${groupName}_chunk_${chunkIndex}`]: chunk }, resolve);
          }));
        });
      });

      // Sort existingGroups based on the new order
      existingGroups.sort((a, b) => a.order - b.order);

      // Save updated groups list
      saveOperations.push(new Promise((resolve) => {
        chrome.storage.sync.set({ groups: existingGroups }, resolve);
      }));

      // Execute all save operations
      Promise.all(saveOperations)
        .then(() => {
          console.log('All groups imported successfully');
          sendResponse({success: true});
        })
        .catch((error) => {
          console.error('Error importing groups:', error);
          sendResponse({success: false, error: error.message});
        });
    });
  } catch (error) {
    console.error('Error parsing import data:', error);
    sendResponse({success: false, error: 'Invalid JSON data: ' + error.message});
  }
  return true; // Indicates that the response is sent asynchronously
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in background:', message);
  switch(message.action) {
    case 'saveSelectedTabs':
      console.log('Received saveSelectedTabs message');
      console.log('Group name:', message.groupName);
      console.log('Tabs:', message.tabs);
      console.log('Is Update:', message.isUpdate);
      saveTabsToGroup(message.groupName, message.tabs, sendResponse, message.isUpdate);
      return true; // Asynchronous response

    case 'getActiveGroup':
  console.log('Getting active group for window:', message.windowId);
  getWindowGroup(message.windowId).then(groupName => {
    console.log('Active group found:', groupName);
    sendResponse({groupName: groupName});
  });
  return true; // Asynchronous response
    
	  if (message.action === 'getActiveGroup') {
    console.log('Getting active group for window:', message.windowId);
    getWindowGroup(message.windowId).then(groupName => {
      console.log('Active group found:', groupName);
      sendResponse({groupName: groupName});
    });
    return true; // Asynchronous response
  }
	
    case 'restoreGroup':
      restoreTabsFromGroup(message.groupName, message.newWindow);
      sendResponse({ status: `Tabs restored from group "${message.groupName}"` });
      return false; // Synchronous response

     case 'deleteGroup':
            deleteGroup(message.groupName, sendResponse);
            return true; // Asynchronous response

    case 'renameGroup':
      renameGroup(message.oldGroupName, message.newGroupName, sendResponse);
      return true; // Asynchronous response

    case 'getGroups':
    chrome.storage.sync.get('groups', function(data) {
        const groups = data.groups || [];
        chrome.storage.local.get(null, function(localData) {
            const groupsWithCounts = groups.map(group => {
                const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${group.name}_chunk_`));
                const tabCount = chunkKeys.reduce((sum, key) => sum + localData[key].length, 0);
                return { ...group, tabCount };
            });
            console.log('Sending groups with counts:', groupsWithCounts);
            sendResponse({ groups: groupsWithCounts });
        });
    });
    return true; // Asynchronous response

    case 'copyGroupUrls':
      copyGroupUrls(message.groupName, sendResponse);
      return true; // Asynchronous response

    case 'copyAllGroupUrls':
      copyAllGroupUrls(sendResponse);
      return true; // Asynchronous response

    case 'exportAllGroups':
      exportAllGroups(sendResponse);
      return true; // Asynchronous response

    case 'importGroups':
      importGroups(message.data, sendResponse);
      return true; // Asynchronous response

    case 'importGroups':
      importGroups(message.data, sendResponse);
      return true; // Asynchronous response

    case 'exportGroup':
            exportSingleGroup(message.groupName, sendResponse);
            return true; // Asynchronous response
			
    case 'importGroup':
            importSingleGroup(message.groupName, message.data, sendResponse);
            return true; // Asynchronous response

    case 'moveGroup':
      moveGroup(message.groupName, message.direction, sendResponse);
      return true; // Asynchronous response

    case 'getGroupTabs':
        getGroupTabs(message.groupName, sendResponse);
        return true; // Asynchronous response

    case 'openSelectedTabs':
      openSelectedTabs(message.groupName, message.selectedTabs, sendResponse);
      return true; // Asynchronous response

    case 'getSelectedUrls':
      getSelectedUrls(message.groupName, message.selectedTabs, sendResponse);
      return true; // Asynchronous response

    case 'deleteTab':
    deleteTabFromGroup(message.tabId, message.groupName, sendResponse);
    return true; // Asynchronous response

    case 'deleteSelectedTabs':
    deleteSelectedTabsFromGroup(message.groupName, message.selectedTabs, sendResponse);
    return true; // Asynchronous response

    case 'reorderGroups':
    reorderGroups(message.newOrder, sendResponse);
    return true;
	
	case 'addUrlsToGroup':
    addUrlsToGroup(message.groupName, message.urls, message.option, sendResponse);
    return true; // Asynchronous response

    default:
            console.error('Unhandled message action:', message.action);
    }
    return true;
});

function exportSingleGroup(groupName, sendResponse) {
    console.log(`Exporting group: ${groupName}`);
    chrome.storage.sync.get('groups', function(data) {
        const groups = data.groups || [];
        const group = groups.find(g => g.name === groupName);
        if (group) {
            chrome.storage.local.get(null, function(localData) {
                const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
                const tabs = chunkKeys.sort().flatMap(key => localData[key]);
                const groupData = {
                    name: group.name,
                    color: group.color,
                    tabs: tabs
                };
                const jsonString = JSON.stringify(groupData, null, 2);
                const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
                sendResponse({success: true, dataUrl: dataUrl, filename: `${groupName}.json`});
            });
        } else {
            console.error(`Group not found: ${groupName}`);
            sendResponse({success: false, error: 'Group not found'});
        }
    });
    return true; // Keeps the message channel open for asynchronous response
}

function importSingleGroup(groupName, data, sendResponse) {
    console.log(`Importing group: ${groupName}`);
    try {
        const importedGroup = JSON.parse(data);
        chrome.storage.sync.get('groups', function(storageData) {
            let groups = storageData.groups || [];
            const existingIndex = groups.findIndex(g => g.name === groupName);

            if (existingIndex !== -1) {
                groups[existingIndex] = {
                    name: groupName,
                    color: importedGroup.color,
                    tabCount: importedGroup.tabs.length
                };
            } else {
                groups.push({
                    name: groupName,
                    color: importedGroup.color,
                    tabCount: importedGroup.tabs.length
                });
            }

            chrome.storage.sync.set({groups: groups}, function() {
                const chunks = [];
                let currentChunk = [];
                let currentSize = 0;

                importedGroup.tabs.forEach((tab) => {
                    const tabString = JSON.stringify(tab);
                    if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }
                    currentChunk.push(tab);
                    currentSize += tabString.length;
                });

                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }

                const savePromises = chunks.map((chunk, index) => {
                    return new Promise((resolve) => {
                        chrome.storage.local.set({[`${groupName}_chunk_${index}`]: chunk}, resolve);
                    });
                });

                Promise.all(savePromises).then(() => {
                    console.log(`Group "${groupName}" imported successfully`);
                    sendResponse({success: true});
                }).catch((error) => {
                    console.error('Error saving imported group:', error);
                    sendResponse({success: false, error: 'Error saving imported group'});
                });
            });
        });
    } catch (error) {
        console.error('Error parsing import data:', error);
        sendResponse({success: false, error: 'Invalid JSON data'});
    }
    return true; // Keeps the message channel open for asynchronous response
}

function getRandomColor() {
  const r = Math.floor(Math.random() * 128);
  const g = Math.floor(Math.random() * 128);
  const b = Math.floor(Math.random() * 128);
  return `rgb(${r},${g},${b})`;
}

function moveGroup(groupName, direction, sendResponse) {
    chrome.storage.sync.get('groups', function(data) {
        let groups = data.groups || [];
        const index = groups.findIndex(group => group.name === groupName);
        if (index === -1) {
            sendResponse({success: false, error: 'Group not found'});
            return;
        }

        let newIndex;
        if (direction === 'up' && index > 0) {
            newIndex = index - 1;
        } else if (direction === 'down' && index < groups.length - 1) {
            newIndex = index + 1;
        } else if (direction === 'first') {
            newIndex = 0;
        } else if (direction === 'last') {
            newIndex = groups.length - 1;
        } else {
            sendResponse({success: false, error: 'Cannot move group further'});
            return;
        }

        const [removedGroup] = groups.splice(index, 1);
        groups.splice(newIndex, 0, removedGroup);

        chrome.storage.sync.set({groups: groups}, function() {
            if (chrome.runtime.lastError) {
                console.error('Error saving reordered groups:', chrome.runtime.lastError);
                sendResponse({success: false, error: chrome.runtime.lastError.message});
            } else {
                sendResponse({success: true});
            }
        });
    });
    return true; // Indicates that the response is sent asynchronously
}

function getGroupTabs(groupName, sendResponse) {
    chrome.storage.local.get(null, function(localData) {
        const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
        const tabs = chunkKeys.sort().flatMap(key => localData[key]);
        console.log('Tabs retrieved for group:', groupName, tabs);
        sendResponse({ tabs: tabs });
    });
    return true; // Keeps the message channel open for asynchronous response
}

function openSelectedTabs(groupName, selectedTabs, sendResponse) {
    console.log(`Opening selected tabs from group "${groupName}":`, selectedTabs);
    chrome.storage.local.get(null, function(localData) {
        const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
        const allTabs = chunkKeys.sort().flatMap(key => localData[key]);
        const tabsToOpen = allTabs.filter(tab => selectedTabs.includes(tab.title));
        console.log(`Found ${tabsToOpen.length} tabs to open`);
        
        const openPromises = tabsToOpen.map(tab => 
            new Promise((resolve) => {
                chrome.tabs.create({ url: tab.url, active: false }, (newTab) => {
                    console.log(`Opened tab: ${tab.url}`);
                    resolve(newTab);
                });
            })
        );

        Promise.all(openPromises).then((openedTabs) => {
            console.log(`Successfully opened ${openedTabs.length} tabs`);
            sendResponse({ success: true, openedCount: openedTabs.length });
        }).catch((error) => {
            console.error('Error opening tabs:', error);
            sendResponse({ success: false, error: error.message });
        });
    });
    return true; // Keeps the message channel open for the asynchronous response
}

function getSelectedUrls(groupName, selectedTabs, sendResponse) {
    console.log(`Getting URLs for selected tabs in group "${groupName}":`, selectedTabs);
    chrome.storage.local.get(null, function(localData) {
        const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
        const allTabs = chunkKeys.sort().flatMap(key => localData[key]);
        const selectedUrls = allTabs
            .filter(tab => selectedTabs.includes(tab.title))
            .map(tab => tab.url);
        console.log(`Found ${selectedUrls.length} URLs for selected tabs`);
        sendResponse({ urls: selectedUrls });
    });
    return true; // Keeps the message channel open for the asynchronous response
}


function deleteTabFromGroup(tabId, groupName, sendResponse) {
    chrome.storage.sync.get('groups', function(data) {
        const groups = data.groups || [];
        const groupIndex = groups.findIndex(group => group.name === groupName);
        if (groupIndex !== -1) {
            chrome.storage.local.get(null, function(localData) {
                const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
                let allTabs = chunkKeys.sort().flatMap(key => localData[key]);
                
                // Find the index of the tab to delete using the tab's title instead of id
                const tabIndex = allTabs.findIndex(tab => tab.title === tabId);
                
                if (tabIndex !== -1) {
                    // Remove only the specific tab
                    allTabs.splice(tabIndex, 1);
                    
                    // Update storage
                    const chunks = [];
                    let currentChunk = [];
                    let currentSize = 0;
                    allTabs.forEach((tab) => {
                        const tabString = JSON.stringify(tab);
                        if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
                            chunks.push(currentChunk);
                            currentChunk = [];
                            currentSize = 0;
                        }
                        currentChunk.push(tab);
                        currentSize += tabString.length;
                    });
                    if (currentChunk.length > 0) {
                        chunks.push(currentChunk);
                    }

                    const saveOperations = chunks.map((chunk, index) => {
                        return new Promise((resolve) => {
                            chrome.storage.local.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
                        });
                    });

                    groups[groupIndex].tabCount = allTabs.length;
                    saveOperations.push(new Promise((resolve) => {
                        chrome.storage.sync.set({ groups: groups }, resolve);
                    }));

                    // Delete old chunk keys that are no longer needed
                    const deleteOperations = chunkKeys.slice(chunks.length).map(key => {
                        return new Promise((resolve) => {
                            chrome.storage.local.remove(key, resolve);
                        });
                    });

                    Promise.all([...saveOperations, ...deleteOperations]).then(() => {
                        sendResponse({success: true});
                    }).catch((error) => {
                        console.error('Error deleting tab:', error);
                        sendResponse({success: false, error: error.message});
                    });
                } else {
                    sendResponse({success: false, error: 'Tab not found in group'});
                }
            });
        } else {
            sendResponse({success: false, error: 'Group not found'});
        }
    });
    return true; // Keeps the message channel open for the asynchronous response
}

function deleteSelectedTabsFromGroup(groupName, selectedTabs, sendResponse) {
    console.log(`Deleting selected tabs from group "${groupName}":`, selectedTabs);
    chrome.storage.sync.get('groups', function(data) {
        const groups = data.groups || [];
        const groupIndex = groups.findIndex(group => group.name === groupName);
        if (groupIndex !== -1) {
            chrome.storage.local.get(null, function(localData) {
                const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
                let allTabs = chunkKeys.sort().flatMap(key => localData[key]);
                const initialTabCount = allTabs.length;
                allTabs = allTabs.filter(tab => !selectedTabs.includes(tab.title));
                console.log(`Removed ${initialTabCount - allTabs.length} tabs`);

                // Update storage (same as before)
                const chunks = [];
                let currentChunk = [];
                let currentSize = 0;
                allTabs.forEach((tab) => {
                    const tabString = JSON.stringify(tab);
                    if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }
                    currentChunk.push(tab);
                    currentSize += tabString.length;
                });
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }

                const saveOperations = chunks.map((chunk, index) => {
                    return new Promise((resolve) => {
                        chrome.storage.local.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
                    });
                });

                groups[groupIndex].tabCount = allTabs.length;
                saveOperations.push(new Promise((resolve) => {
                    chrome.storage.sync.set({ groups: groups }, resolve);
                }));

                Promise.all(saveOperations).then(() => {
                    console.log(`Successfully deleted tabs. New tab count: ${allTabs.length}`);
                    sendResponse({success: true});
                }).catch((error) => {
                    console.error('Error deleting selected tabs:', error);
                    sendResponse({success: false, error: error.message});
                });
            });
        } else {
            console.error(`Group "${groupName}" not found`);
            sendResponse({success: false, error: 'Group not found'});
        }
    });
    return true; // Keeps the message channel open for the asynchronous response
}

function reorderGroups(newOrder, sendResponse) {
    console.log('Reordering groups:', newOrder);
    chrome.storage.sync.get('groups', function(data) {
        let groups = data.groups || [];
        
        // Create a map for quick lookup of groups by name
        const groupMap = new Map(groups.map(g => [g.name, g]));
        
        // Create a new array of groups in the new order
        const reorderedGroups = newOrder.map((name, index) => {
            const group = groupMap.get(name);
            if (group) {
                return {...group, order: index};
            }
            return null;
        }).filter(g => g !== null);

        console.log('Reordered groups:', reorderedGroups);

        // Save the reordered groups
        chrome.storage.sync.set({groups: reorderedGroups}, function() {
            if (chrome.runtime.lastError) {
                console.error('Error saving reordered groups:', chrome.runtime.lastError);
                sendResponse({success: false, error: chrome.runtime.lastError.message});
            } else {
                console.log('Groups reordered and saved successfully');
                sendResponse({success: true});
            }
        });
    });
}

function addUrlsToGroup(groupName, urls, option, sendResponse) {
    chrome.storage.sync.get('groups', function(data) {
        let groups = data.groups || [];
        const groupIndex = groups.findIndex(group => group.name === groupName);

        if (groupIndex === -1) {
            sendResponse({success: false, error: 'Group not found'});
            return;
        }

        chrome.storage.local.get(null, function(localData) {
            const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
            let existingTabs = chunkKeys.sort().flatMap(key => localData[key]);

            const newTabs = urls.map(url => ({url: url, title: url}));

            if (option === 'replace') {
                existingTabs = newTabs;
            } else { // append
                existingTabs = existingTabs.concat(newTabs);
            }

            groups[groupIndex].tabCount = existingTabs.length;

            // Save updated group info
            chrome.storage.sync.set({groups: groups}, function() {
                // Save tabs in chunks
                const chunks = [];
                let currentChunk = [];
                let currentSize = 0;

                existingTabs.forEach((tab, index) => {
                    const tabString = JSON.stringify(tab);
                    if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }
                    currentChunk.push(tab);
                    currentSize += tabString.length;
                });

                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }

                const saveOperations = chunks.map((chunk, index) => {
                    return new Promise((resolve) => {
                        chrome.storage.local.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
                    });
                });

                Promise.all(saveOperations).then(() => {
    // After saving, fetch titles for the new tabs
    fetchTitlesForTabs(groupName, newTabs).then(() => {
        sendResponse({success: true});
        chrome.runtime.sendMessage({ action: 'refreshGroups' });
    });
}).catch((error) => {
    console.error('Error saving tabs:', error);
    sendResponse({success: false, error: 'Error saving tabs'});
});
            });
        });
    });
    return true; // Keeps the message channel open for asynchronous response
}

function fetchTitlesForTabs(groupName, tabs) {
    return new Promise((resolve) => {
        const fetchPromises = tabs.map(tab => 
            new Promise((resolveTab) => {
                chrome.tabs.create({ url: tab.url, active: false }, (createdTab) => {
                    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                        if (tabId === createdTab.id && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            chrome.tabs.get(tabId, (updatedTab) => {
                                tab.title = updatedTab.title || tab.url;
                                chrome.tabs.remove(tabId);
                                resolveTab();
                            });
                        }
                    });
                });
            })
        );

        Promise.all(fetchPromises).then(() => {
            // Update the tabs in storage with new titles
            chrome.storage.local.get(null, function(localData) {
                const chunkKeys = Object.keys(localData).filter(key => key.startsWith(`${groupName}_chunk_`));
                let allTabs = chunkKeys.sort().flatMap(key => localData[key]);

                // Update titles for matching URLs
                allTabs = allTabs.map(existingTab => {
                    const updatedTab = tabs.find(newTab => newTab.url === existingTab.url);
                    return updatedTab || existingTab;
                });

                // Save updated tabs back to storage
                const chunks = [];
                let currentChunk = [];
                let currentSize = 0;

                allTabs.forEach((tab) => {
                    const tabString = JSON.stringify(tab);
                    if (currentSize + tabString.length > MAX_CHUNK_SIZE) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentSize = 0;
                    }
                    currentChunk.push(tab);
                    currentSize += tabString.length;
                });

                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }

                const saveOperations = chunks.map((chunk, index) => {
                    return new Promise((resolve) => {
                        chrome.storage.local.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
                    });
                });

                Promise.all(saveOperations).then(resolve);
            });
        });
    });
}

function logWindowGroupMap() {
  chrome.storage.local.get(['windowGroupMap'], (result) => {
    console.log('Current windowGroupMap:', result.windowGroupMap);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    chrome.windows.get(tab.windowId, (window) => {
      getWindowGroup(window.id).then(groupName => {
        if (groupName) {
          console.log(`Tab updated in window ${window.id}, associated with group ${groupName}`);
        }
      });
    });
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    getWindowGroup(windowId).then(groupName => {
      console.log(`Window ${windowId} focused, associated group: ${groupName}`);
    });
  }
});

function setWindowGroup(windowId, groupName) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['windowGroupMap'], (result) => {
      const map = result.windowGroupMap || {};
      map[windowId] = groupName;
      chrome.storage.local.set({windowGroupMap: map}, () => {
        console.log(`Window ${windowId} associated with group ${groupName}`);
        resolve();
      });
    });
  });
}

function getWindowGroup(windowId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['windowGroupMap'], (result) => {
      const map = result.windowGroupMap || {};
      resolve(map[windowId]);
    });
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get(['windowGroupMap'], (result) => {
    const map = result.windowGroupMap || {};
    delete map[windowId];
    chrome.storage.local.set({windowGroupMap: map});
  });
});

function logError(message, error) {
  console.error(`Tabbin Error: ${message}`, error);
  // You could also implement a system to send errors to your server for monitoring
}

function logWindowGroupMap() {
  chrome.storage.local.get(['windowGroupMap'], (result) => {
    console.log('Current windowGroupMap:', result.windowGroupMap);
  });
}

function debugLog(message) {
  console.log(`[Tabbin Debug] ${new Date().toISOString()}: ${message}`);
}