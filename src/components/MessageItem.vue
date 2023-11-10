<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { Message, MessageType } from '../store/messages';

const MessageTypeClass: Record<MessageType, string> = {
  [MessageType.Error]: 'error',
  [MessageType.Warning]: 'warn',
  [MessageType.Info]: 'info',
  [MessageType.Success]: '',
};

export default defineComponent({
  props: {
    message: {
      type: Object as PropType<Message>,
      required: true,
    },
  },
  setup(props) {
    const { message } = toRefs(props);

    const headerClass = computed(() => {
      const type = MessageTypeClass[message.value.type];
      if (type?.length) {
        return `${type}-message`;
      }
      return '';
    });

    return {
      headerClass,
    };
  },
});
</script>

<template>
  <v-expansion-panel>
    <v-expansion-panel-title :class="headerClass">
      <div class="header">
        <span>{{ message.title }}</span>
        <v-btn
          icon="mdi-delete"
          variant="text"
          size="small"
          class="mr-3"
          @click.stop="$emit('delete')"
        />
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text v-if="message.options.details">
      <div class="mt-4">
        <pre class="details">{{ message.options.details }}</pre>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.error-message {
  background-color: #ef5350;
}

.warn-message {
  background-color: #ffa726;
}

.info-message {
  background-color: #26c6da;
}

.header {
  width: 100%;
  display: flex;
  flex-flow: row;
  justify-content: space-between;
  align-items: center;
  user-select: text;
}

.details {
  white-space: break-spaces;
  user-select: text;
}
</style>
