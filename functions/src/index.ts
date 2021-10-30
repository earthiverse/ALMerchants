import admin from "firebase-admin";
import * as functions from "firebase-functions";
import {SecretManagerServiceClient} from "@google-cloud/secret-manager"
import AL, { ItemDataTrade, ItemName, TradeSlotType } from "alclient";

// Log console logs
import "firebase-functions/lib/logger/compat"

// Setup
admin.initializeApp();
const client = new SecretManagerServiceClient();

export const updateMerchants = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Get credential information
  const [secret] = await client.accessSecretVersion({
    name: "projects/896895177782/secrets/al_credentials/versions/latest",
  });
  const dataString = secret?.payload?.data?.toString()
  if(dataString == undefined) throw Error("Couldn't get credentials from secret manager")
  const data = JSON.parse(dataString);
  
  // Get the latest merchant data
  await AL.Game.login(data.email, data.password, data.mongo)
  const merchantData = await AL.Game.getMerchants()
  const now = Date.now()
  const today = now - now % (60*60*24)
  res.send({data: merchantData})


  // Update merchant data
  for(const merchant of merchantData) {
    admin.database().ref(`merchants/${merchant.name}`).set(
      {
        lastSeen: now,
         ...merchant
      })
  }

  // Update price history data
  const priceHistoryData: {
    [T in ItemName]?: {
      buying?: ItemDataTrade
      selling?: ItemDataTrade
    }
  } = {  }

  for(const merchant of merchantData) {
    for(const slot in merchant.slots) {
      const itemData = merchant.slots[slot as TradeSlotType]
      if(itemData === undefined) continue // No item. This shouldn't happen, though.

      const itemName = itemData.name

      // TODO: I need a way to store price history for various levels, instead of just level 0
      if(itemData.level !== undefined && itemData.level > 0) continue
      // TODO: I need a way to store price history for various modifiers
      if(itemData.p !== undefined) continue
      // TODO: I need a way to store price history for various cosmetics
      if(itemData.data) continue

      if(priceHistoryData[itemName] === undefined) {
        priceHistoryData[itemName] = { }
      }
      const newPriceHistoryData = priceHistoryData[itemName]
      if(newPriceHistoryData === undefined) continue // NOTE: I know it's defined, but Typescript was giving me a lot of errors without this

      if(itemData.b) {
        // They are buying, check if it's a new high price
        if(!newPriceHistoryData.buying) {
          // We didn't have any data before
          newPriceHistoryData.buying = itemData
        } else {
          // We have to check if they're paying more than the last offer
          if(newPriceHistoryData.buying.price > itemData.price) continue // This offer isn't as good
          newPriceHistoryData.buying = itemData
        }
      } else {
        // They are selling, check if it's a new low price
        if(!newPriceHistoryData.selling) {
          // We didn't have any data before
          newPriceHistoryData.selling = itemData
        } else {
          // We have to check if they're selling it for less than the last offer
          if(newPriceHistoryData.selling.price < itemData.price) continue // This offer isn't as good
          newPriceHistoryData.selling = itemData
        }
      }
    }
  }

  for(const hName in priceHistoryData) {
    const itemName = hName as ItemName
    const newPriceHistoryData = priceHistoryData[itemName]
    if(newPriceHistoryData === undefined) continue // NOTE: I know it's defined, but Typescript was giving me a lot of errors without this
    
    admin.database().ref(`history/${itemName}/${today}`).once("value", (data) => {
      const oldPriceHistoryData = data.val()

      if(oldPriceHistoryData == null) {
        // We don't have old data, let's add some
        admin.database().ref(`history/${itemName}/${today}`).set(newPriceHistoryData).catch((e) => console.error(e))
        return
      }

      if(oldPriceHistoryData.buying == undefined && newPriceHistoryData.buying) {
        // We don't have buying data, let's add some
        admin.database().ref(`history/${itemName}/${today}/buying`).set(newPriceHistoryData.buying).catch((e) => console.error(e))
      } else if(oldPriceHistoryData.buying && newPriceHistoryData.buying && newPriceHistoryData.buying.price > oldPriceHistoryData.buying.price) {
        // Someone is paying more for the item now
        admin.database().ref(`history/${itemName}/${today}/buying`).set(newPriceHistoryData.buying).catch((e) => console.error(e))
      }

      if(oldPriceHistoryData.selling == undefined && newPriceHistoryData.selling) {
        // We don't have selling data, let's add some
        admin.database().ref(`history/${itemName}/${today}/selling`).set(newPriceHistoryData.selling).catch((e) => console.error(e))
      } else if(oldPriceHistoryData.selling && newPriceHistoryData.selling && newPriceHistoryData.selling.price < oldPriceHistoryData.selling.price) {
        // Someone is selling the same item for less now
        admin.database().ref(`history/${itemName}/${today}/selling`).set(newPriceHistoryData.selling).catch((e) => console.error(e))
      }
    })
  }
});