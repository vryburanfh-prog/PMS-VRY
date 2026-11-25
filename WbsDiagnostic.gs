
function diagnoseWbsData() {
  const projectId = "PRJ-BSCS";

  const tabs = [
    { name: "Main_WBS", id: "Main_WBS_ID" },
    { name: "Sub_WBS", id: "Sub_WBS_ID" },
    { name: "Sub_Sub_WBS", id: "Sub_Sub_WBS_ID" },
    { name: "Activities_Schedule", id: "Activity_ID" },
    { name: "Schedule_Dependencies", id: "Dependency_ID" }
  ];

  tabs.forEach(tab => {
    const records = getTableRecords_(tab.name);

    const matching = records.filter(r =>
      String(r.Project_ID || "").trim() === projectId
    );

    Logger.log("================================");
    Logger.log("TABLE: " + tab.name);
    Logger.log("TOTAL RECORDS: " + records.length);
    Logger.log("MATCHING PROJECT: " + matching.length);

    if (matching.length > 0) {
      Logger.log("SAMPLE RECORD:");
      Logger.log(JSON.stringify(matching[0]));
    } else if (records.length > 0) {
      Logger.log("AVAILABLE PROJECT IDS:");
      Logger.log(JSON.stringify(
        [...new Set(records.map(r => r.Project_ID))]
      ));
    }
  });
}


function diagnoseWbsDashboardApi() {
  const result = apiGetProjectWbsAndSchedule("PRJ-BSCS");

  Logger.log("DASHBOARD API RESULT");
  Logger.log("Success: " + result.success);
  Logger.log("Main WBS: " + result.mainWbs.length);
  Logger.log("Sub WBS: " + result.subWbs.length);
  Logger.log("Sub-sub WBS: " + result.subSubWbs.length);
  Logger.log("Activities: " + result.activities.length);
  Logger.log("Dependencies: " + result.dependencies.length);
  Logger.log("Hierarchy depth: " + result.wbsHierarchyDepth);
  Logger.log("Can manage WBS: " + result.canManageWbs);
  Logger.log("Can view/create activities: " + result.canCreateActivities);
}

