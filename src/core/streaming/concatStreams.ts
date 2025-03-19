/**
 * Concatenates multiple streams together in order.
 * @param streams
 * @returns
 */
export function concatStreams<T>(
  ...streams: ReadableStream<T>[]
): ReadableStream<T> {
  let reader: ReadableStreamDefaultReader<T> | null = null;
  return new ReadableStream({
    async pull(controller) {
      let enqueued = false;
      while (!enqueued && streams.length) {
        if (!reader) {
          reader = streams[0].getReader();
        }

        // eslint-disable-next-line no-await-in-loop
        const result = await reader.read();

        if (result.value) {
          controller.enqueue(result.value);
          enqueued = true;
        }

        if (result.done) {
          streams.shift();
          reader = null;
        }
      }

      if (streams.length === 0) {
        controller.close();
      }
    },
  });
}
