<script setup lang="ts">
import { ref } from 'vue';
import FHIR from 'fhirclient';

// --- CERNER EHR --- //

function processOAuthMessage(msg: any) {
  sessionStorage[msg.storage.key] = msg.storage.value;
  window.history.pushState("object or string", "Title", `/?code=${msg.code}&state=${msg.state}`);
  FHIR.oauth2.ready()
      .then((fhirClient) => {
        return fhirClient.request("Patient");
      })
      .then((info) => {
        const element = document.getElementById('PatientInfoArea');
        if (element) {
          element.innerHTML = info?.entry[0]?.resource?.text?.div;
        }
      }).catch(console.error);
}

function cernerLogin() {
  const screenWidth = 1920;
  const screenHeight = 1080;
  const width = 780;
  const height = 550;
  const left = (screenWidth - width) / 2;
  let top = (screenHeight - height) / 2;
  const uniqueWindowId = '_blank';
  if (top > 20) {
    top -= 20;
  }
  let params = `width=${width}, height=${height}`;
  params += `, top=${top}, left=${left}`;
  params += ', titlebar=no, location=no, popup=yes';
  const url = "http://localhost:4173/lungair/cerner-app-launch/launch.html?iss=https://fhir-myrecord.cerner.com/dstu2/ec2458f2-1e24-41c8-b71b-0e701af7583d";
  const loginWindow = window.open(url, uniqueWindowId, params);
  window.addEventListener("message", (e) => {
    const oauthMessage = e.data;
    loginWindow?.close();
    if (oauthMessage && oauthMessage.url && oauthMessage.code && oauthMessage.state && oauthMessage.storage) {
      processOAuthMessage(oauthMessage);
    }
  }, false);
}

const doCernerLoginLoading = ref(false);
const doCernerLogin = async () => {
  doCernerLoginLoading.value = true;
  try {
    cernerLogin();
  } finally {
    doCernerLoginLoading.value = false;
  }
};
</script>

<template>
  <div class="overflow-y-auto overflow-x-hidden ma-2 fill-height">
    <v-divider />
    <div>
      <v-list-subheader>Cerner EHR</v-list-subheader>
      <v-row class="mb-3">
        <v-col cols="3">
          <div id="PatientInfoArea"></div>
        </v-col>
      </v-row>
      <v-row class="mb-3">
        <v-btn @click="doCernerLogin" :loading="doCernerLoginLoading">
          Login
        </v-btn>
      </v-row>
    </div>
    <v-divider />
  </div>
</template>
