<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import { loadUserPromptedFiles } from '@/src/actions/loadUserFiles';
import useRemoteSaveStateStore from '@/src/store/remote-save-state';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSession from '@/src/components/SaveSession.vue';
import ControlButton from '@/src/components/ControlButton.vue';
import MessageNotifications from '@/src/components/MessageNotifications.vue';
import Settings from '@/src/components/Settings.vue';
import ControlsStripTools from '@/src/components/ControlsStripTools.vue';
import MessageCenter from '@/src/components/MessageCenter.vue';
import { MessageType, useMessageStore } from '@/src/store/messages';
import { ConnectionState, useServerStore } from '@/src/store/server';
import { useViewStore } from '@/src/store/views';
import { Layouts } from '@/src/config';

interface Props {
  hasData: boolean;
}

defineProps<Props>();

function useViewLayout() {
  const viewStore = useViewStore();
  const layoutName = ref('Quad View');
  const { layout: currentLayout } = storeToRefs(viewStore);

  watch(
    layoutName,
    () => {
      const layout = Layouts[layoutName.value] || [];
      viewStore.setLayout(layout);
    },
    {
      immediate: true,
    }
  );

  watch(currentLayout, () => {
    if (
      currentLayout.value?.name &&
      currentLayout.value.name !== layoutName.value
    ) {
      layoutName.value = currentLayout.value.name;
    }
  });

  return layoutName;
}

function useSaveControls() {
  const remoteSaveStateStore = useRemoteSaveStateStore();
  const { isSaving, saveUrl } = storeToRefs(remoteSaveStateStore);

  const saveDialog = ref(false);

  const handleSave = () => {
    if (saveUrl.value !== '') {
      remoteSaveStateStore.saveState();
    } else {
      saveDialog.value = true;
    }
  };

  return { handleSave, isSaving, saveDialog };
}

function useMessageBubble() {
  const messageStore = useMessageStore();
  const count = computed(() => messageStore.importantMessages.length);
  const badgeColor = computed(() => {
    if (
      messageStore.importantMessages.find(
        (msg) => msg.type === MessageType.Error
      )
    ) {
      return 'error';
    }
    if (
      messageStore.importantMessages.find(
        (msg) => msg.type === MessageType.Warning
      )
    ) {
      return 'warning';
    }
    return 'primary';
  });

  return { count, badgeColor };
}

function useServerConnection() {
  const serverStore = useServerStore();

  const icon = computed(() => {
    switch (serverStore.connState) {
      case ConnectionState.Connected:
        return 'mdi-lan-check';
      case ConnectionState.Disconnected:
        return 'mdi-lan-disconnect';
      case ConnectionState.Pending:
        return 'mdi-lan-pending';
      default:
        throw new Error('Invalid connection state');
    }
  });

  const { url } = storeToRefs(serverStore);

  return { icon, url };
}

const settingsDialog = ref(false);
const messageDialog = ref(false);
const { icon: connIcon, url: serverUrl } = useServerConnection();
const layoutName = useViewLayout();
const { handleSave, saveDialog, isSaving } = useSaveControls();
const { count: msgCount, badgeColor: msgBadgeColor } = useMessageBubble();
</script>

<template>
  <div
    id="tools-strip"
    class="bg-grey-darken-4 d-flex flex-column align-center"
  >
    <control-button
      size="40"
      icon="mdi-folder-open"
      name="Open files"
      @click="loadUserPromptedFiles"
    />
    <control-button
      size="40"
      icon="mdi-content-save-all"
      name="Save session"
      :loading="isSaving"
      @click="handleSave"
    />
    <div class="my-1 tool-separator" />
    <v-menu location="right" :close-on-content-click="true">
      <template v-slot:activator="{ props }">
        <div>
          <control-button
            v-bind="props"
            size="40"
            icon="mdi-view-dashboard"
            name="Layouts"
          />
        </div>
      </template>
      <v-card>
        <v-card-text>
          <v-radio-group v-model="layoutName" class="mt-0" hide-details>
            <v-radio
              v-for="(value, key) in Layouts"
              :key="key"
              :label="value.name"
              :value="key"
            />
          </v-radio-group>
        </v-card-text>
      </v-card>
    </v-menu>
    <controls-strip-tools v-if="hasData" />
    <v-spacer />
    <control-button
      v-if="serverUrl"
      size="40"
      :icon="connIcon"
      name="Open Server Settings"
      @click="settingsDialog = true"
    />
    <v-badge
      offset-x="10"
      offset-y="10"
      :content="msgCount"
      :color="msgBadgeColor"
      :model-value="msgCount > 0"
      id="notifications"
    >
      <control-button
        size="40"
        icon="mdi-bell-outline"
        name="Notifications"
        @click="messageDialog = true"
      />
    </v-badge>
    <control-button
      size="40"
      icon="mdi-cog"
      name="Settings"
      @click="settingsDialog = true"
    />
  </div>
  <closeable-dialog v-model="saveDialog" max-width="30%">
    <template v-slot="{ close }">
      <save-session :close="close" />
    </template>
  </closeable-dialog>
  <closeable-dialog v-model="messageDialog" content-class="fill-height">
    <message-center />
  </closeable-dialog>

  <message-notifications @open-notifications="messageDialog = true" />

  <closeable-dialog v-model="settingsDialog">
    <settings />
  </closeable-dialog>
</template>

<style src="@/src/components/styles/utils.css"></style>
<style scoped>
#tools-strip {
  border-left: 1px solid #212121;
  flex: 0 0 40px;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}
</style>
