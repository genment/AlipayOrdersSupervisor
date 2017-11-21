"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var axios_1 = require("axios");
var logger_1 = require("./logger");
var crypto = require("crypto");
var config_1 = require("./config");
var https = require("https");
var qs = require("qs");
var AV = require("leancloud-storage");
var Pusher = /** @class */ (function () {
    function Pusher(apiUrl, appId, appKey, secret, serverType) {
        if (serverType == "LeanCloud") {
            AV.init({
                appId: appId,
                appKey: appKey
            });
            this.TradeInfo = AV.Object.extend("TradeInfo");
        }
        else {
            this.api =
                apiUrl +
                    "?appId=" +
                    appId +
                    "&appKey=" +
                    appKey +
                    "&event=new_order";
            this.secret = secret;
            this.ax = axios_1.default.create({
                timeout: 10000,
                withCredentials: true,
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                }),
                headers: {
                    "Content-type": "application/x-www-form-urlencoded"
                }
            });
        }
    }
    Pusher.prototype.pushStateToLeanCloud = function (orderData, callback) {
        var tradeInfo = new this.TradeInfo();
        tradeInfo.set("tradeNo", orderData.tradeNo);
        tradeInfo.set("orderId", orderData.orderId);
        tradeInfo.set("tradeTime", orderData.time);
        tradeInfo.set("username", orderData.username);
        tradeInfo.set("amount", orderData.amount);
        tradeInfo.set("desc", orderData.desc);
        tradeInfo.set("memo", orderData.memo);
        tradeInfo.set("status", orderData.status);
        new AV.Query("TradeInfo")
            .equalTo("tradeNo", orderData.tradeNo)
            .count()
            .then(function (count) {
            if (count == 0) {
                tradeInfo.save()
                    .then(function () {
                    if (typeof callback == "function") {
                        callback.call(this, null, "success");
                    }
                }, function (error) {
                    if (typeof callback == "function") {
                        callback.call(this, error);
                    }
                });
            }
        });
    };
    Pusher.prototype.pushStateToDefaultServer = function (orderData, callback) {
        var _this = this;
        // 签名
        var md5 = crypto.createHash("md5");
        var sig = [
            orderData.time.toString(),
            orderData.tradeNo.toString(),
            orderData.amount.toString(),
            orderData.status.toString(),
            this.secret.toString()
        ].join("|");
        sig = md5.update(sig, "utf8").digest("hex");
        // Post body
        orderData.sig = sig;
        orderData.version = config_1.default.version;
        var form = qs.stringify(orderData);
        this.ax
            .post(this.api, form)
            .then(function (response) {
            if (Number(response.status) !== 200) {
                logger_1.default("push order: " +
                    orderData.tradeNo +
                    " completed, Response(Not 200 OK): " +
                    response.data.toString(), "push");
            }
            else {
                logger_1.default("push order: " +
                    orderData.tradeNo +
                    " completed, Response: " +
                    response.data.toString(), "push");
                //console.log(body);
                if (typeof callback == "function") {
                    callback.call(_this, null, response.data.toString());
                }
            }
        })
            .catch(function (err) {
            logger_1.default(err.code + "," + err.message, "pushError");
            if (typeof callback == "function") {
                callback.call(_this, err);
            }
        });
    };
    return Pusher;
}());
exports.default = Pusher;
