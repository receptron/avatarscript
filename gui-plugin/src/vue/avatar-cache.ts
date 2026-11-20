// The avatars this page has fetched: a card holds no avatar (it would be megabytes in every card),
// so the view asks the tool's server side for it through the host's runtime dispatch. Cards of the
// same avatar from the same runtime share one request. "The same avatar" is the performance's
// `avatarKey` (the server's digest of where the avatar is from), so a host whose own avatar
// changed, or two hosts in one page with different avatars of their own, are told apart.
import type { AvatarAssets, PerformanceData } from "avatarscript";
import { AVATAR_REQUEST, parseAvatarReply } from "../requests.ts";

/** What reaches the tool's server side: the host's runtime, whose identity scopes what was fetched through it. */
export interface AvatarSource {
  dispatch(args: object): Promise<unknown>;
}

const fetched = new WeakMap<AvatarSource, Map<string, Promise<AvatarAssets>>>();

/** The avatar of a performance: the one it names (an https URL), or the host's own. */
export function fetchAvatar(source: AvatarSource, performance: Pick<PerformanceData, "avatar" | "avatarKey">): Promise<AvatarAssets> {
  const { avatar } = performance;
  const key = performance.avatarKey ?? avatar ?? "";
  const known = fetched.get(source) ?? new Map<string, Promise<AvatarAssets>>();
  fetched.set(source, known);
  const earlier = known.get(key);
  if (earlier !== undefined) return earlier;
  const request = (async (): Promise<AvatarAssets> => {
    const reply = parseAvatarReply(await source.dispatch({ kind: AVATAR_REQUEST, ...(avatar === undefined ? {} : { avatar }) }));
    if (reply === undefined) throw new Error("the host did not answer with an avatar");
    if (reply.outcome === "failed") throw new Error(reply.message);
    return { rig: reply.rig, assets: reply.assets };
  })();
  known.set(key, request);
  // A request that failed is asked again by the next card, not remembered as the answer.
  request.catch(() => known.delete(key));
  return request;
}
