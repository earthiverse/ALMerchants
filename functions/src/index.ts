import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {SecretManagerServiceClient} from "@google-cloud/secret-manager"

import * as AL from "alclient"

// Log console logs
require("firebase-functions/lib/logger/compat");

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
  res.send({data: merchantData})

  // Update data in database
  for(const merchant of merchantData) {
    admin.database().ref(`merchants/${merchant.name}`).set(
      {
        lastSeen: Date.now(),
         ...merchant
      })
  }
});
