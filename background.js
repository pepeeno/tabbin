chrome.runtime.onInstalled.addListener(() => {
  console.log('Tabbin installed');
});

const saveTabsToGroup = (groupName, tabs, color) => {
  chrome.storage.sync.get('groups', function(data) {
    const groups = data.groups || [];
    const groupIndex = groups.findIndex(group => group.name === groupName);
    const newGroup = { name: groupName, color: color || getRandomColor(), tabs: tabs };
    
    if (groupIndex === -1) {
      groups.push(newGroup);
    } else {
      groups[groupIndex] = newGroup;
    }
    
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
    
    const saveOperations = chunks.map((chunk, index) => {
      return new Promise((resolve) => {
        chrome.storage.sync.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
      });
    });
    
    saveOperations.push(new Promise((resolve) => {
      chrome.storage.sync.set({ groups: groups }, resolve);
    }));
    
    Promise.all(saveOperations).then(() => {
      console.log(`Tabs saved to group ${groupName}`);
    }).catch((error) => {
      console.error(`Error saving group ${groupName}:`, error);
    });
  });
};

const restoreTabsFromGroup = (groupName) => {
  chrome.storage.sync.get(null, function(data) {
    const groups = data.groups || [];
    const group = groups.find(group => group.name === groupName);
    
    if (group) {
      const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${groupName}_chunk_`));
      const tabs = chunkKeys.sort().flatMap(key => data[key]);
      
      if (tabs && tabs.length > 0) {
        tabs.forEach(tab => {
          chrome.tabs.create({ url: tab.url });
        });
        console.log(`Tabs restored from group ${groupName}`);
      } else {
        console.error(`No tabs found for group ${groupName}`);
      }
    } else {
      console.error(`Group ${groupName} not found`);
    }
  });
};

const deleteGroup = (groupName) => {
  chrome.storage.sync.get('groups', function(data) {
    let groups = data.groups || [];
    groups = groups.filter(group => group.name !== groupName);
    
    chrome.storage.sync.get(null, function(allData) {
      const chunkKeys = Object.keys(allData).filter(key => key.startsWith(`${groupName}_chunk_`));
      
      const deleteOperations = chunkKeys.map(key => {
        return new Promise((resolve) => {
          chrome.storage.sync.remove(key, resolve);
        });
      });
      
      deleteOperations.push(new Promise((resolve) => {
        chrome.storage.sync.set({ groups: groups }, resolve);
      }));
      
      Promise.all(deleteOperations).then(() => {
        console.log(`Group ${groupName} deleted`);
      });
    });
  });
};

const renameGroup = (oldGroupName, newGroupName) => {
  chrome.storage.sync.get(null, function(data) {
    const groups = data.groups || [];
    const groupIndex = groups.findIndex(group => group.name === oldGroupName);
    
    if (groupIndex !== -1) {
      const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${oldGroupName}_chunk_`));
      const chunks = chunkKeys.sort().map(key => data[key]);
      
      // Remove old chunks
      const deleteOperations = chunkKeys.map(key => {
        return new Promise((resolve) => {
          chrome.storage.sync.remove(key, resolve);
        });
      });
      
      // Save new chunks
      const saveOperations = chunks.map((chunk, index) => {
        return new Promise((resolve) => {
          chrome.storage.sync.set({ [`${newGroupName}_chunk_${index}`]: chunk }, resolve);
        });
      });
      
      groups[groupIndex].name = newGroupName;
      
      Promise.all([...deleteOperations, ...saveOperations]).then(() => {
        chrome.storage.sync.set({ groups: groups }, () => {
          console.log(`Group renamed from ${oldGroupName} to ${newGroupName}`);
        });
      });
    }
  });
};

const copyGroupUrls = (groupName, sendResponse) => {
  chrome.storage.sync.get(null, function(data) {
    const groups = data.groups || [];
    const group = groups.find(group => group.name === groupName);
    
    if (group) {
      const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${groupName}_chunk_`));
      const tabs = chunkKeys.sort().flatMap(key => data[key]);
      
      if (tabs && tabs.length > 0) {
        const urls = tabs.map(tab => tab.url);
        sendResponse({ urls: urls });
      } else {
        console.error(`No tabs found for group ${groupName}`);
        sendResponse({ urls: [], error: 'No tabs found in group' });
      }
    } else {
      console.error(`Group ${groupName} not found`);
      sendResponse({ urls: [], error: 'Group not found' });
    }
  });
};

const copyAllGroupUrls = (sendResponse) => {
  chrome.storage.sync.get(null, function(data) {
    const groups = data.groups || [];
    let allUrls = [];
    
    const urlPromises = groups.map(group => {
      return new Promise((resolve) => {
        const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${group.name}_chunk_`));
        const tabs = chunkKeys.sort().flatMap(key => data[key]);
        if (tabs && tabs.length > 0) {
          const urls = tabs.map(tab => tab.url);
          resolve(urls);
        } else {
          resolve([]);
        }
      });
    });
    
    Promise.all(urlPromises).then((urlArrays) => {
      allUrls = urlArrays.flat();
      sendResponse({ urls: allUrls });
    });
  });
  return true;
};

function exportAllGroups(sendResponse) {
  chrome.storage.sync.get(null, function(data) {
    const groups = data.groups || [];
    let exportData = [];
    
    const groupPromises = groups.map(group => {
      return new Promise((resolve) => {
        const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${group.name}_chunk_`));
        const tabs = chunkKeys.sort().flatMap(key => data[key]);
        exportData.push({
          name: group.name,
          color: group.color,
          tabs: tabs
        });
        resolve();
      });
    });
    
    Promise.all(groupPromises).then(() => {
      const jsonString = JSON.stringify(exportData, null, 2);
      const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
      
      chrome.downloads.download({
        url: dataUrl,
        filename: 'all_groups.json',
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
    });
  });
  return true;
}

function exportSingleGroup(groupName, sendResponse) {
  chrome.storage.sync.get(null, function(data) {
    const groups = data.groups || [];
    const group = groups.find(g => g.name === groupName);
    
    if (group) {
      const chunkKeys = Object.keys(data).filter(key => key.startsWith(`${groupName}_chunk_`));
      const tabs = chunkKeys.sort().flatMap(key => data[key]);
      const exportData = {
        name: group.name,
        color: group.color,
        tabs: tabs
      };
      
      const jsonString = JSON.stringify(exportData, null, 2);
      const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
      
      chrome.downloads.download({
        url: dataUrl,
        filename: `${groupName}.json`,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('Download error:', chrome.runtime.lastError);
          sendResponse({success: false, error: chrome.runtime.lastError.message});
        } else {
          console.log('Group exported successfully');
          sendResponse({success: true});
        }
      });
    } else {
      sendResponse({success: false, error: 'Group not found'});
    }
  });
  return true;
}

const importGroups = (data, sendResponse) => {
  try {
    const importedGroups = JSON.parse(data);
    console.log('Parsed imported groups:', importedGroups);
    
    chrome.storage.sync.get('groups', function(storageData) {
      let existingGroups = storageData.groups || [];
      const saveOperations = [];
      
      importedGroups.forEach(importedGroup => {
        const groupName = importedGroup.name;
        const tabs = importedGroup.tabs || [];
        const color = importedGroup.color || getRandomColor();
        
        const existingIndex = existingGroups.findIndex(g => g.name === groupName);
        if (existingIndex !== -1) {
          existingGroups[existingIndex] = { name: groupName, color: color, tabs: tabs };
        } else {
          existingGroups.push({ name: groupName, color: color, tabs: tabs });
        }
        
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
        
        chunks.forEach((chunk, index) => {
          saveOperations.push(new Promise((resolve) => {
            chrome.storage.sync.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
          }));
        });
      });
      
      saveOperations.push(new Promise((resolve) => {
        chrome.storage.sync.set({ groups: existingGroups }, resolve);
      }));
      
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
  return true;
};

function importSingleGroup(groupName, data, sendResponse) {
  try {
    const importedGroup = JSON.parse(data);
    console.log('Parsed imported group:', importedGroup);
    
    chrome.storage.sync.get('groups', function(storageData) {
      let existingGroups = storageData.groups || [];
      const tabs = importedGroup.tabs || [];
      const color = importedGroup.color || getRandomColor();
      
      const existingIndex = existingGroups.findIndex(g => g.name === groupName);
      if (existingIndex !== -1) {
        existingGroups[existingIndex] = { name: groupName, color: color };
      } else {
        existingGroups.push({ name: groupName, color: color });
      }
      
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
      
      const saveOperations = chunks.map((chunk, index) => {
        return new Promise((resolve) => {
          chrome.storage.sync.set({ [`${groupName}_chunk_${index}`]: chunk }, resolve);
        });
      });
      
      saveOperations.push(new Promise((resolve) => {
        chrome.storage.sync.set({ groups: existingGroups }, resolve);
      }));
      
      Promise.all(saveOperations)
        .then(() => {
          console.log('Group imported successfully');
          sendResponse({success: true});
        })
        .catch((error) => {
          console.error('Error importing group:', error);
          sendResponse({success: false, error: error.message});
        });
    });
  } catch (error) {
    console.error('Error parsing import data:', error);
    sendResponse({success: false, error: 'Invalid JSON data: ' + error.message});
  }
  return true;
}

function getRandomColor() {
  const r = Math.floor(Math.random() * 128);
  const g = Math.floor(Math.random() * 128);
  const b = Math.floor(Math.random() * 128);
  return `rgb(${r},${g},${b})`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch(message.action) {
    case 'saveSelectedTabs':
      saveTabsToGroup(message.groupName, message.tabs, message.color);
      sendResponse({ status: `Tabs saved to group "${message.groupName}"` });
      break;
      
    case 'restoreGroup':
      restoreTabsFromGroup(message.groupName);
      sendResponse({ status: `Tabs restored from group "${message.groupName}"` });
      break;
      
    case 'deleteGroup':
      deleteGroup(message.groupName);
      sendResponse({ status: `Group "${message.groupName}" deleted` });
      break;
      
    case 'renameGroup':
      renameGroup(message.oldGroupName, message.newGroupName);
      sendResponse({ status: `Group renamed to "${message.newGroupName}"` });
      break;
      
    case 'getGroups':
      chrome.storage.sync.get('groups', function(data) {
        sendResponse({ groups: data.groups || [] });
      });
      return true;