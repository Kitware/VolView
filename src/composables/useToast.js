import { createToastInterface } from 'vue-toastification';

const toast = createToastInterface({
  position: 'bottom-left',
  timeout: 3000,
  hideProgressBar: true,
  maxToasts: 3,
  transition: 'Vue-Toastification__fade',
});

export const useToast = () => toast;
