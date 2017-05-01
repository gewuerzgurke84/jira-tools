// const not available, but better solution needed
var CELLTYPE_EMPTY = -1;
var CELLTYPE_JIRAID = 10; // entire cell includes Jira ticket id only ("JIRA-123" or "JIRA-123 [Status]")
var CELLTYPE_TEXT = 20;  // Jira ticket id is within text ("lorem ipsum JIRA-123 [Status] dolores")

// Jira issue fields/columns
var ISSUE_COLUMNS = {
  // defaults
  summary: 'Summary',
  issuetype: 'Issue Type',
  priority: 'Priority',
  status: 'Status',
  updated: 'Updated',
  created: 'Created',
  assignee: 'Assignee',
  creator: 'Creator',
  reporter: 'Reporter',
  due: 'Due',
  /* --- */
  labels: 'Labels',
  project: 'Project',
  fixVersions: 'Fix Version',
  components: 'Components',
  description: 'Description',
  resolution: 'Resolution',
  timespent: 'Time spent',
  timeestimate: 'Estimate', // remaining
  timeoriginalestimate: 'Original estimate',
  aggregatetimespent: 'Aggregate Time Spent',
  aggregatetimeestimate: 'Aggregate Time Estimate',
  aggregateprogress: 'Aggregate Progress',
  progress: 'Progress'
};
//@see storage.gs for jiraColumnDefault


/**
 * @desc Get current active sheet
 * @return {Sheet}
 */
function getTicketSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
}

/**
 * @desc Find valid Jira Ticket ID from cell value.
 *     Valid ticket id format: KEY-123
 * @param cellValue {string}
 * @return {string}    Returns Jira ticket ID if found or NULL
 */
function grepJiraTicketId(cellValue) {
  var ticketId = cellValue.match(/[A-Z]+\-\d+/);
  return (ticketId==null ? null : ticketId[0]);
}

/**
 * @desc More sufficiticated cell value analyzation. For multiple ways of ticket Ids within text.
 *       Checks the cell value and returns a object with information for type,value,ticketId and match parts.
 * @param cellValue {string}
 * @return {object}
 */
function grepJiraCell(cellValue) {
  var cellProps = {
    type: CELLTYPE_EMPTY,
    value: cellValue,
    ticketId: null,
    parts: []
  };

  if(cellValue.trim() == '') {
    return cellProps;
  }

  //@TODO: regexp requires lots of tweaking

  // match: "JIRA-123"
  match = cellValue.match(/^([A-Z]+\-\d+)$/);
  if(match && match.length == 2) {
    cellProps = {
      type: CELLTYPE_JIRAID,
      value: cellValue,
      ticketId: match[1],
      parts: match
    }
    return cellProps;
  }
  
  // match: "JIRA-123 [Status]"
  match = cellValue.match(/^([A-Z]+\-\d+)\s?(\[[\w\s]+\])$/);
  if(match && match.length == 3) {
    cellProps = {
      type: CELLTYPE_JIRAID,
      value: cellValue,
      ticketId: match[1],
      parts: match
    }
    return cellProps;
  }
  
  // match: "lorem ipsum JIRA-123 [Status] dolores"
  match = reverse(cellValue).match(/(.*)((\][\w\s]+\[)\s?(\d+-[A-Z]+(?!-?[a-zA-Z]{1,10})))(.*)/);
  if(match && match.length == 6) {
    // remove status part
    cellValue = cellValue.replace(' ' + reverse(match[3]), '').trim();
    cellProps = {
      type: CELLTYPE_TEXT,
      value: cellValue,
      ticketId: reverse(match[4]),
      parts: match
    }
    return cellProps;
  }
  
  // match: "lorem ipsum JIRA-123 dolores"
  match = reverse(cellValue).match(/(\d+-[A-Z]+(?!-?[a-zA-Z]{1,10}))(.*)/);
  if(match && match.length == 3) {
    cellProps = {
      type: CELLTYPE_TEXT,
      value: cellValue,
      ticketId: reverse(match[1]),
      parts: match
    }
    return cellProps;
  }
  
  return cellProps;
  
/* Debug Info
IN: IT-123
OUT: {"type":10,"value":"IT-123","ticketId":"IT-123","parts":["IT-123","IT-123"]}
----------------------------------
IN: IT-123 [Status]
OUT: {"type":10,"value":"IT-123 [Status]","ticketId":"IT-123","parts":["IT-123 [Status]","IT-123","[Status]"]}
----------------------------------
IN: Lorem ispum IT-123
OUT: {"type":20,"value":"Lorem ispum IT-123","ticketId":"IT-123","parts":["321-TI mupsi meroL","321-TI"," mupsi meroL"]}
----------------------------------
IN: Lorem ispum IT-123 dolores
OUT: {"type":20,"value":"Lorem ispum IT-123 dolores","ticketId":"IT-123","parts":["321-TI mupsi meroL","321-TI"," mupsi meroL"]}
----------------------------------
IN: Lorem ispum IT-123 [Status]
OUT: {"type":20,"value":"Lorem ispum IT-123","ticketId":"IT-123","parts":["]sutatS[ 321-TI mupsi meroL","","]sutatS[ 321-TI","]sutatS[","321-TI"," mupsi meroL"]}
----------------------------------
IN: Lorem ispum IT-123 [Status] dolores
OUT: {"type":20,"value":"Lorem ispum IT-123 dolores","ticketId":"IT-123","parts":["serolod ]sutatS[ 321-TI mupsi meroL","serolod ","]sutatS[ 321-TI","]sutatS[","321-TI"," mupsi meroL"]}
----------------------------------
*/
}

/**
 * @desc Helper to simplify Jira's status field response. 
 *     Less IF/ELSE and property scopes needed.
 * @deprecated
 * @param fields {Object}  JSON objec from Jira response attribute 'fields'
 * @return {Object} Object({name:[string], color:[string]})
 */
function getIssueStatus(fields) {
  var o = {
    'name': 'n/a',
    'color': ''
  };

  try {
    o.name = fields.status.name;
    o.color = fields.status.statusCategory.colorName;
  } catch (e) {}

  return o;
}


/**
 * @desc Request users own (and favourite) filters and return an object of main props.
 * @param {boolean} includeFavourites  Include users favourite filters or not
 * @return {object} Object({[id]:{name:{string}, self:{string}, favourite:{boolean}, owner:{string}, viewUrl:{string}}})
 */
function getMyFilters(includeFavourites) {
  var method = "myFilters", filters = [];

  var ok = function(responseData, httpResponse, statusCode){
    // Check the data is valid and the Jira fields exist
    if(responseData) {
      for(var i in responseData) {
        filters.push({
          id: responseData[i].id,
          name: responseData[i].name,
          self: responseData[i].self,
          favourite: responseData[i].favourite,
          owner: responseData[i].owner.displayName,
          viewUrl: responseData[i].viewUrl,
          jql: responseData[i].jql
        });
      }
      // sorting the list of filters by favourite, name
      filters.sort(function(a, b){
        var keyA = (a.favourite ? '0' : '1') + a.name,
          keyB = (b.favourite ? '0' : '1') + b.name;

        if (keyA < keyB)
          return -1;
        if (keyA > keyB)
          return 1;
        return 0;
      });
      
    } else {
      // Something funky is up with the JSON response.
      Logger.log("Failed to retrieve jira filters!");
    }
  };

  var error = function(responseData, httpResponse, statusCode) {
    Logger.log("Failed to retrieve jira filters with status [" + statusCode + "]!\\n" + responseData.errorMessages.join("\\n"));
  };

  var request = new Request();

  request.call(method, {includeFavourites:(includeFavourites?'true':'false')})
    .withSuccessHandler(ok)
    .withFailureHandler(error);

  return filters;
}

/**
 * @desc Returns a filter given an id
 * @param filterId {int}  FilterId to get filter info for
 * @return {object}
 */
function getFilter(filterId) {
  var method = "filter",
      filter = {},
      request = new Request();

  var ok = function(responseData, httpResponse, statusCode){
    // Check the data is valid and the Jira fields exist
    if(responseData) {
      filter = responseData;
    } else {
      // Something funky is up with the JSON response.
      Logger.log("Failed to retrieve jira filter info!");
    }
  };

  var error = function(responseData, httpResponse, statusCode) {
    Logger.log("Failed to retrieve jira filter with status [" + statusCode + "]!\\n" + responseData.errorMessages.join("\\n"));
  };

  request.call(method, {filterId:filterId})
    .withSuccessHandler(ok)
    .withFailureHandler(error);

  return filter;
}

/**
 * @desc Helper to convert indiv. jira field/property objects 
 *       into simple objects for using as cell data.
 * @param attrib {string}
 * @param data {object}
 * @return {object}
 */
function unifyIssueAttrib(attrib, data) {
  var resp = {value: ''};
  
  try { // no error handling, always return a valid object
  switch(attrib) {
    case 'status':
      resp = {
        value: data.fields.status.name || 'n/a',
        color: data.fields.status.statusCategory.colorName || 'black',
        format: '@[' + (data.fields.status.statusCategory.colorName || 'black') + ']'
      };
      break;
    case 'resolution':
      resp = {
        value: data.fields.resolution.name,
        format: '@[green]'
      };
      break;
    case 'key':
      resp = {
        value: data.key || 'n/a',
        link: "https://" + getCfg('jira_domain') + "/browse/" + data.key
      };
      break;
    case 'summary':
      resp.value = data.fields.summary || '';
      break;
    case 'issuetype':
      resp = {
        value: data.fields.issuetype.name || '',
        subtask: data.fields.issuetype.subtask || false,
        iconUrl: data.fields.issuetype.iconUrl || ''
      };
      break;
    case 'assignee':
    case 'creator':
    case 'reporter':
      resp = {
        value: data.fields[attrib].displayName || 'Unknown',
        avatarUrls: data.fields[attrib].avatarUrls['24x24'] || ''
      };
      break;
    case 'priority':
      resp = {
        value: data.fields.priority.name || 'n/a',
        iconUrl: data.fields.priority.iconUrl || ''
      };
      break;
    case 'updated':
      resp = {
        value: data.fields.updated || 'n/a',
        date: new Date(getDateFromIso(data.fields.updated)) || new Date(),
        format: "dd.mm.yyyy"
      };
      break;
    case 'duedate':
      resp = {
        value: data.fields.duedate || 'n/a',
        date: new Date(getDateFromIso(data.fields.duedate)) || new Date(),
        format: "dd.mm.yyyy"
      };
      break;
    case 'timespent':
    case 'timeestimate':
    case 'timeoriginalestimate':
    case 'aggregatetimespent':
    case 'aggregatetimeestimate':
      resp = {
        value: parseInt(data.fields[attrib]) || 0,
        format: "0"
      };
      break;
    case 'labels':
      resp = {
        value: data.fields.labels.join(',')
      };
      break

    default:
      Logger.log('unifyIssueAttrib(' + attrib + ') no format defined yet.');
      resp.value = data[attrib] || data.fields[attrib];
      break;
  }
  } catch (e) {}
  
  return resp;
}

/**
 * @desc Return table header title for issue property
 * @param header {string}  Property key name to get header title for
 * @return {string}
 */
function headerNames(header) {
  var label, labels = ISSUE_COLUMNS;
  extend(labels, {
    key: 'Key',
    issuetype: 'Type',
    duedate: 'Due',
    priority: 'P',
  });

  if( !labels.hasOwnProperty(header) ) {
    label = camelize(header);
  } else {
    label = labels[header];
  }

  return label;
}