<script lang="ts">
import { defineComponent, del, watch } from '@vue/composition-api';
import { useToast } from '@/src/composables/useToast';
import { storeToRefs } from 'pinia';
import { ToastID } from 'vue-toastification/dist/types/src/types';
import { Message, MessageType, useMessageStore } from '../store/messages';

const TIMEOUT = 5000;

export default defineComponent({
  setup(props, { emit }) {
    const messageStore = useMessageStore();
    const { byID } = storeToRefs(messageStore);

    const toasts = {} as Record<string, ToastID>;

    const toast = useToast();
    const makeToastOptions = (msgID: string) => ({
      timeout: byID.value[msgID].options.persist ? (false as const) : TIMEOUT,
      closeOnClick: !byID.value[msgID].options.persist,
      onClick: () => emit('open-notifications'),
      onClose: () => {
        del(toasts, msgID);
      },
    });

    // remove toasts if the message is gone
    watch(byID, (msgLookup) => {
      Object.keys(toasts).forEach((msgID) => {
        if (!(msgID in msgLookup)) {
          toast.dismiss(toasts[msgID]);
          del(toasts, msgID);
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

          let id: ToastID | null = null;
          if (message.type === MessageType.Error) {
            id = toast.error(message.title, makeToastOptions(msgID));
          } else if (message.type === MessageType.Warning) {
            id = toast.warning(message.title, makeToastOptions(msgID));
          } else if (message.type === MessageType.Info) {
            id = toast.info(message.title, makeToastOptions(msgID));
          } else if (message.type === MessageType.Success) {
            id = toast.success(message.title, makeToastOptions(msgID));
          }

          if (id !== null) {
            toasts[msgID] = id;
          }
        });
      }
    });

    return () => null;
  },
});
</script>
