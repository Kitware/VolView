<script lang="ts">
import { computed, defineComponent, ref } from '@vue/composition-api';
import { storeToRefs } from 'pinia';
import { MessageType, useMessageStore } from '../store/messages';
import MessageItem from './MessageItem.vue';

function watchResize(
  element: Element,
  callback: (el: Element) => void,
  timeout = 10
) {
  let timeoutID = -1;
  let observer: ResizeObserver;

  const refreshTimeout = (cb: Function) => {
    clearTimeout(timeoutID);
    timeoutID = setTimeout(cb, timeout);
  };

  const cleanup = () => {
    observer.disconnect();
  };

  observer = new ResizeObserver(() => {
    refreshTimeout(cleanup);
    callback(element);
  });

  observer.observe(element);
}

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

    const messageListEl = ref<HTMLElement>();

    let cachedLast = -Infinity;
    function scrollIfLast(openPanels: number[]) {
      const last = Math.max(...openPanels);
      const listEl = messageListEl.value;
      if (
        last === messages.value.length - 1 &&
        // detect if the last panel is already expanded
        last !== cachedLast &&
        listEl?.firstElementChild
      ) {
        watchResize(listEl.firstElementChild, () => {
          const height = listEl.scrollHeight;
          listEl.scroll(0, height);
        });
      }
      cachedLast = last;
    }

    return {
      deleteItem,
      clearAll: messageStore.clearAll,
      scrollIfLast,
      messageListEl,
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
    <v-card-title>
      <span>Notifications</span>
      <v-spacer />
      <v-btn icon @click="$emit('close')"><v-icon>mdi-close</v-icon></v-btn>
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
      <div class="message-list ma-2" ref="messageListEl">
        <v-expansion-panels
          accordion
          multiple
          hover
          :value="filteredMessages.map((_, i) => i)"
          @change="scrollIfLast"
        >
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
