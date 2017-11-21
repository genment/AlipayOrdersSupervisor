"use strict";
// # Alipay-Supervisor
Object.defineProperty(exports, "__esModule", { value: true });
var config_1 = require("./config");
var email_1 = require("./email");
var push_1 = require("./push");
// import logger from "./logger";
var axios_1 = require("axios");
var https = require("https");
var fs = require("fs");
var cheerio = require("cheerio");
var iconv = require("iconv-lite");
var trim = require("lodash/trim");
var moment = require("moment");
var mailer = new email_1.default(config_1.default.smtpHost, config_1.default.smtpPort, config_1.default.smtpUsername, config_1.default.smtpPassword);
var pusher = new push_1.default(config_1.default.pushStateAPI, config_1.default.pushAppId, config_1.default.pushAppKey, config_1.default.pushStateSecret, config_1.default.serverType);
var ax = axios_1.default.create({
    timeout: 3000,
    withCredentials: true,
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    }),
    responseType: "arraybuffer",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.99 Safari/537.36",
        Cookie: config_1.default.alipayCookies
    }
});
// 订单列表页面是GBK编码，特殊处理
ax.interceptors.response.use(function (response) {
    var ctype = response.headers["content-type"];
    response.data = ctype.includes("charset=GBK")
        ? iconv.decode(response.data, "GBK")
        : iconv.decode(response.data, "utf-8");
    return response;
});
// 已推送成功的订单列表
function restoreOrderList() {
    var filename = moment().utcOffset(8).format("YYYY_MM_DD") + ".json";
    // 先add空值确保文件存在
    fs.writeFileSync("./orders/" + filename, "", { flag: "a" });
    var ordersString = fs.readFileSync("./orders/" + filename);
    try {
        return JSON.parse(ordersString ? ordersString.toString() : "{}");
    }
    catch (error) {
        return {};
    }
}
function backupOrderList() {
    var ordersString = JSON.stringify(orderList);
    var filename = moment().utcOffset(8).format("YYYY_MM_DD") + ".json";
    fs.writeFileSync("./orders/" + filename, ordersString);
}
var orderList = restoreOrderList();
// Util - 打印log添加时间前缀
function timePrefixLog(text) {
    if (!config_1.default.debug || !text) {
        return;
    }
    console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + text.toString());
}
// Util - 恢复被转义的unicode字符 (\\uXXXX)
function decodeUnic(s) {
    return global.unescape(s.replace(/\\(u[0-9a-fA-F]{4})/gm, "%$1"));
}
// 请求订单页面并获取页面HTML字符串
function checkOrderListPageHtmlString() {
    timePrefixLog("Start fetch orders");
    // 先请求个人主页
    ax
        .get("https://my.alipay.com/portal/i.htm")
        .then(function (response) {
        if (Number(response.status) !== 200) {
            throw new Error("Invalid response status code");
        }
        else {
            return ax.get("https://consumeprod.alipay.com/record/advanced.htm?fundFlow=in&_input_charset=utf-8");
        }
    })
        .then(function (response) {
        var result = response.data.replace('charset="GBK"', 'charset="utf-8"');
        timePrefixLog("Fetch orders page content successfully");
        fs.writeFile("orders.html", result, function () { });
        parseOrdersHtml(result);
    })
        .catch(function (err) {
        timePrefixLog(err.code || err.message || err.toString());
        // Email报告
        if (config_1.default.enableExNotify) {
            mailer.sendMail("Alipay Supervisor Service Notice", "<b>An web request error happened in your alipay supervisor</b><br>" +
                err.message, config_1.default.email);
        }
    });
}
// 解析订单页面HTML
function parseOrdersHtml(html) {
    timePrefixLog("Star parse page content");
    var $ = cheerio.load(html);
    // 检查是否含有列表form以判断是否订单列表页(例如cookies无效时是返回登录页的内容)
    var form = $("#J-submit-form");
    if (form.length < 1) {
        timePrefixLog("Response html is not valid");
        // Email报告
        mailer.sendMail("Alipay Supervisor Service Notice", "<b>An error happened in your alipay supervisor</b><br>Maybe the cookies has expired, please update it and restart the supervisor", config_1.default.email);
        return false;
    }
    var orderTable = $("#tradeRecordsIndex>tbody");
    var orderRows = orderTable.find("tr");
    orderRows.each(function (_index, _ele) {
        var orderData = {};
        var orderRow = $(this);
        // 订单时间
        var timeSel = orderRow.children("td.time").children("p");
        orderData.time =
            trim(timeSel.first().text()) + " " + trim(timeSel.last().text());
        // 备注
        orderData.memo = trim(orderRow.find(".memo-info").text());
        // 订单描述
        orderData.desc = trim(orderRow
            .children("td.name")
            .children("p")
            .text());
        // 订单商户流水号(商户独立系统)与订单交易号(支付宝系统)
        var orderNoData = orderRow
            .children("td.tradeNo")
            .children("p")
            .text()
            .split("|");
        if (orderNoData.length > 1) {
            orderData.orderId = trim(orderNoData[0].split(":")[1]);
            orderData.tradeNo = trim(orderNoData[1].split(":")[1]);
        }
        else {
            orderData.tradeNo = trim(orderNoData[0].split(":")[1]);
        }
        // 对方支付宝用户名
        orderData.username = trim(decodeUnic(orderRow
            .children("td.other")
            .children("p")
            .text()));
        // 金额
        var amountText = orderRow
            .children("td.amount")
            .children("span")
            .text()
            .replace(" ", ""); // + 100.00 / - 100.00 / 100.00
        orderData.amount = parseFloat(amountText);
        // 订单状态
        orderData.status = orderRow
            .children("td.status")
            .children("p")
            .text();
        // 推送通知
        if (orderData.amount > 0 && orderData.status == "交易成功" && orderData.desc.indexOf("余额宝") < 0) {
            pushStateToServer(orderData); // 仅对非余额宝的收入做处理
        }
    });
    timePrefixLog("Parse content completed");
    //fs.writeFile('orders.json', JSON.stringify(orderList));
}
// 通知服务器
function pushStateToServer(orderData) {
    if (orderList[orderData["tradeNo"]]) {
        timePrefixLog("Order #" + orderData.tradeNo + " has been handled successfully, ignored it.");
        return;
    }
    var callback = function (err, resp) {
        if (err) {
            // Email报告
            if (config_1.default.enableExNotify) {
                mailer.sendMail("Alipay Supervisor Service Notice", "<b>An error happened in your alipay supervisor</b><br>Push state to remote server with error returned, please check your server configuration.<br>The error info is: " +
                    resp.code +
                    ", " +
                    resp.message, config_1.default.email);
            }
        }
        else if (resp == "success") {
            orderList[orderData["tradeNo"]] = orderData;
            backupOrderList(); //将orderList保存到文件
            // Email报告
            mailer.sendMail("[Success]Alipay Supervisor Service Notice", "<b>A order is handled successfully in your alipay supervisor</b><br>The order info is: <pre>" +
                JSON.stringify(orderData) +
                "</pre>", config_1.default.email);
        }
    };
    timePrefixLog("Start push order status to server");
    if (config_1.default.serverType == "LeanCloud") {
        pusher.pushStateToLeanCloud(orderData, callback);
    }
    else {
        pusher.pushStateToDefaultServer(orderData, callback);
    }
}
// 每日通过邮件报告
function dailyReport() {
    // Email报告
    var date = new Date();
    mailer.sendMail("Alipay Supervisor Service Daily Report(" + date.toLocaleString() + ")", "<b>Currently handled orders:</b><br><pre>" +
        JSON.stringify(orderList) +
        "</pre>", config_1.default.email);
}
// 版本检查
function checkVersion() {
    ax.get("https://webapproach.net/apsv/version.json").then(function (response) {
        if (Number(response.status) === 200) {
            // ok
            var checkInfo = JSON.parse(response.data.toString());
            if (checkInfo.version !== config_1.default.version) {
                var msg = "AlipaySupervisor已更新至" +
                    checkInfo.version +
                    ", 当前版本为" +
                    config_1.default.version +
                    "<br> 请访问" +
                    checkInfo.url +
                    "查看更多详情";
                mailer.sendMail("AlipaySupervisor已更新", msg, config_1.default.email);
            }
        }
    });
}
// Test - 使用本地文件解析测试
// fs.readFile('orders.html','utf-8', function(err,data){
//     if(err){
//         console.log(err);
//     }else{
//         parseOrdersHtml(data);
//     }
// });
// Test - logger
//logger('test content');
// Test - mailer
//email.sendMail('event notice', '<b>an event happened in your alipay supervisor</b>', config.email);
// Test - push
// var testOrderData = {
//     time: "2016.11.29 21:51",
//     memo: "转账",
//     description: "转账",
//     tradeNo: "20161129XXXXXXXXXXXXXXXXX2354351",
//     username: "XXXXX",
//     amount: 150,
//     status: "交易成功"
// };
// var callback = function(body){
//     console.log(body);
// };
// push.pushState(testOrderData, callback);
exports.default = {
    startUp: checkOrderListPageHtmlString,
    dailyReport: dailyReport,
    checkVersion: checkVersion
};
