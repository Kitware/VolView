export function logError(error: unknown) {
  let cur = error;
  while (cur) {
    if (cur !== error) {
      console.error('The above error was caused by:', cur);
    } else {
      console.error(cur);
    }

    if (cur instanceof Error) {
      cur = cur.cause;
    } else {
      cur = null;
    }
  }
}
