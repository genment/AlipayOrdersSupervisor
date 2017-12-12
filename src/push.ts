import axios from "axios";
import logger from "./logger";
import * as crypto from "crypto";
import config from "./config";
import * as https from "https";
import * as qs from "qs";
import * as AV from "leancloud-storage"

export default class Pusher {
    private api: string;
    private secret: string;
    private ax;

    private TradeInfo;

    public constructor(apiUrl, appId, appKey, secret, serverType) {
        if (serverType == "LeanCloud") {
            AV.init({
                appId: appId,
                appKey: appKey
            });
            this.TradeInfo = AV.Object.extend("TradeInfo");
        } else {
            this.api =
                apiUrl +
                "?appId=" +
                appId +
                "&appKey=" +
                appKey +
                "&event=new_order";
            this.secret = secret;
            this.ax = axios.create({
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

    public pushStateToLeanCloud(orderData, callback) {
        
        let tradeInfo = new this.TradeInfo();
        tradeInfo.set("tradeNo", orderData.tradeNo);
        tradeInfo.set("orderId", orderData.orderId);
        tradeInfo.set("tradeTime", orderData.time);
        tradeInfo.set("username", orderData.username);
        tradeInfo.set("amount", orderData.amount);
        tradeInfo.set("desc", orderData.desc);
        tradeInfo.set("memo", orderData.memo);
        tradeInfo.set("status", orderData.status);
        
        // new AV.Query("TradeInfo")
        // .equalTo("tradeNo",orderData.tradeNo)
        // .count()
        // .then(function(count){
        //     if(count == 0){
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
        //     }
        // });
    }

    public pushStateToDefaultServer(orderData, callback) {
        // 签名
        const md5 = crypto.createHash("md5");
        let sig = [
            orderData.time.toString(),
            orderData.tradeNo.toString(),
            orderData.amount.toString(),
            orderData.status.toString(),
            this.secret.toString()
        ].join("|");
        sig = md5.update(sig, "utf8").digest("hex");
        // Post body
        orderData.sig = sig;
        orderData.version = config.version;
        const form = qs.stringify(orderData);

        this.ax
            .post(this.api, form)
            .then(response => {
                if (Number(response.status) !== 200) {
                    logger(
                        "push order: " +
                            orderData.tradeNo +
                            " completed, Response(Not 200 OK): " +
                            response.data.toString(),
                        "push"
                    );
                } else {
                    logger(
                        "push order: " +
                            orderData.tradeNo +
                            " completed, Response: " +
                            response.data.toString(),
                        "push"
                    );
                    //console.log(body);
                    if (typeof callback == "function") {
                        callback.call(this, null, response.data.toString());
                    }
                }
            })
            .catch(err => {
                logger(err.code + "," + err.message, "pushError");
                if (typeof callback == "function") {
                    callback.call(this, err);
                }
            });
    }
}
