<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { MessageType, useMessageStore } from '../store/messages';
import MessageItem from './MessageItem.vue';

export default defineComponent({
  components: {
    MessageItem,
  },
  setup() {
    const messageStore = useMessageStore();
    const { messages } = storeToRefs(messageStore);

    const showErrors = ref(true);
    const showWarnings = ref(true);
    const showInfo = ref(true);

    const filteredMessages = computed(() => {
      const show = {
        errors: showErrors.value,
        warnings: showWarnings.value,
        info: showInfo.value,
      };
      return messages.value.filter(
        (msg) =>
          (msg.type === MessageType.Error && show.errors) ||
          (msg.type === MessageType.Warning && show.warnings) ||
          (msg.type === MessageType.Info && show.info)
      );
    });

    function deleteItem(messageID: string) {
      messageStore.clearOne(messageID);
    }

    return {
      deleteItem,
      clearAll: () => {
        messageStore.clearAll();
      },
      showErrors,
      showWarnings,
      showInfo,
      filteredMessages,
    };
  },
});
</script>

<template>
  <v-card class="fill-height message-center">
    <v-card-title class="d-flex flex-row align-center">
      <span>Notifications</span>
    </v-card-title>
    <v-card-text class="content-container pt-4">
      <div class="action-bar ma-2">
        <div class="filter-bar">
          <v-checkbox
            v-model="showErrors"
            class="px-2"
            hide-details
            label="Error"
          />
          <v-checkbox
            v-model="showWarnings"
            class="px-2"
            hide-details
            label="Warning"
          />
          <v-checkbox
            v-model="showInfo"
            class="px-2"
            hide-details
            label="Info"
          />
        </div>
        <v-btn color="secondary" @click="clearAll">
          <v-icon class="mr-2">mdi-delete</v-icon>
          <span>Clear All</span>
        </v-btn>
      </div>
      <div class="message-list ma-2">
        <v-expansion-panels variant="accordion" multiple>
          <message-item
            v-for="msg in filteredMessages"
            :key="msg.id"
            :message="msg"
            @delete="deleteItem(msg.id)"
          />
        </v-expansion-panels>
        <template v-if="filteredMessages.length === 0">
          <div class="empty">No notifications to display</div>
        </template>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.message-center {
  display: flex;
  flex-flow: column;
}

.content-container {
  display: flex;
  flex-flow: column;
  overflow: hidden;
}

.message-list {
  overflow-y: auto;
  scroll-behavior: smooth;
}

.action-bar {
  display: flex;
  flex-flow: row;
  justify-content: space-between;
  align-items: center;
}

.filter-bar {
  display: flex;
  flex-flow: row;
  justify-content: space-between;
}

.empty {
  text-align: center;
  font-size: 1.4rem;
  margin-top: 36px;
  padding: 16px;
}
</style>
