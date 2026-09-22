/**
 * "Am I in a browser?", as an outside store.
 *
 * Next renders a client component on the server too, and some things can only
 * be true once React has taken the page over: a sanitiser needs a real DOM, a
 * file box needs somebody listening for its change. There are two answers and
 * they never change afterwards — the server's and the browser's — so nothing
 * ever has to be told, and the subscription is empty.
 *
 * Read it with `useSyncExternalStore(tellNobody, inBrowser, onServer)`. Do not
 * copy it into state in an effect: that is a second render for an answer the
 * first one already had, and the lint rule refuses it.
 */

export const tellNobody = () => () => {};
export const inBrowser = () => true;
export const onServer = () => false;
