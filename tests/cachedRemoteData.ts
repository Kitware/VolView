import { TEST_DATASETS } from '../wdio.shared.conf';
import { BASE_URL } from './e2ePorts';

/** Read cached fixtures through HTTP while preserving remote manifest identities. */
export async function useCachedRemoteData() {
  const urls = Object.fromEntries(
    TEST_DATASETS.map(({ url, name }) => [
      url,
      new URL(`tmp/${name}`, BASE_URL).href,
    ])
  );
  await browser.addInitScript((cached: Record<string, string>) => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const local = cached[url];
      const target =
        local && input instanceof Request
          ? new Request(local, input)
          : (local ?? input);
      return fetch(target, init);
    };
  }, urls);
}
