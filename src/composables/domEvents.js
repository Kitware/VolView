import {
  onBeforeUnmount,
  onMounted,
  ref,
  unref,
  watch,
} from '@vue/composition-api';

/**
 *
 * @param {Ref<HTMLElement>} domRef
 * @param {Function} callback
 * @param {Object|Boolean} options If boolean, this is useCapture.
 */
export function useElementListener(elmRef, event, callback, options = false) {
  const subscribed = ref(false);

  function subscribe(elm) {
    if (elm && !subscribed.value) {
      elm.addEventListener(event, callback, options);
      subscribed.value = true;
    }
  }

  function unsubscribe(elm) {
    if (elm && subscribed.value) {
      elm.removeEventListener(event, callback, options);
      subscribed.value = false;
    }
  }

  watch(
    elmRef,
    (elm, oldElm) => {
      unsubscribe(oldElm);
      subscribe(elm);
    },
    { immediate: true }
  );

  onMounted(() => subscribe(unref(elmRef)));
  onBeforeUnmount(() => unsubscribe(unref(elmRef)));

  return { subscribed, unsubscribe };
}
