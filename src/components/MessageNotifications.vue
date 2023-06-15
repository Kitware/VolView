<script lang="ts">
import { defineComponent, watch } from 'vue';
import { useToast } from '@/src/composables/useToast';
import { storeToRefs } from 'pinia';
import type { ToastID } from 'vue-toastification/dist/types/types';
import { Message, MessageType, useMessageStore } from '../store/messages';
import MessageNotificationContent from './MessageNotificationContent.vue';

const TIMEOUT = 5000;

export default defineComponent({
  setup(props, { emit }) {
    const messageStore = useMessageStore();
    const { byID } = storeToRefs(messageStore);

    const toasts = {} as Record<string, ToastID>;

    const toast = useToast();
    type ToastMethod =
      | typeof toast.info
      | typeof toast.success
      | typeof toast.warning
      | typeof toast.error;

    const makeToastOptions = (msgID: string) => ({
      timeout: byID.value[msgID].options.persist ? (false as const) : TIMEOUT,
      closeOnClick: !byID.value[msgID].options.persist,
      onClick: () => emit('open-notifications'),
      onClose: () => {
        delete toasts[msgID];
      },
    });

    // remove toasts if the message is gone
    watch(byID, (msgLookup) => {
      Object.keys(toasts).forEach((msgID) => {
        if (!(msgID in msgLookup)) {
          toast.dismiss(toasts[msgID]);
          delete toasts[msgID];
        }
      });
    });

    messageStore.$onAction(({ name, args, after }) => {
      if (name === '_addMessage') {
        const message = args[0] as Omit<Message, 'id'>;
        after((msgID) => {
          if (!msgID) {
            return;
          }

          let toastMethod: ToastMethod = toast.info;
          let showDetailsButton = false;

          if (message.type === MessageType.Error) {
            toastMethod = toast.error;
            showDetailsButton = true;
          } else if (message.type === MessageType.Warning) {
            toastMethod = toast.warning;
            showDetailsButton = true;
          } else if (message.type === MessageType.Info) {
            toastMethod = toast.info;
          } else if (message.type === MessageType.Success) {
            toastMethod = toast.success;
          }

          toasts[msgID] = toastMethod(
            {
              component: MessageNotificationContent,
              props: {
                message: message.title,
                detailsButton: showDetailsButton,
              },
            },
            makeToastOptions(msgID)
          );
        });
      }
    });

    return () => null;
  },
});
</script>
