// # Alipay-Supervisor Startup
import * as schedule from "node-schedule";
import Supervisor from "./alipay";
import config from "./config";

// 每分钟第30秒执行check order
function scheduleCronCheckOrdersTask() {
    schedule.scheduleJob(
        `37 */${config.interval} * * * *`,
        function() {
            Supervisor.startUp();
        }
    );
}

// 每天的23点59 daily report
function scheduleCronReportTask() {
    if (config.dailyReport) {
        schedule.scheduleJob({ hour: 23, minute: 59 }, function() {
            Supervisor.dailyReport();
        });
    }
}

// 每天的08点检查更新
function scheduleCronVersionCheckTask() {
    if (config.checkUpdate) {
        schedule.scheduleJob({ hour: 8, minute: 0 }, function() {
            Supervisor.checkVersion();
        });
    }
}

scheduleCronCheckOrdersTask();
scheduleCronReportTask();
scheduleCronVersionCheckTask();
