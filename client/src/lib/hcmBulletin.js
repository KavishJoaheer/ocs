export function isHcmPostWithinBulletinWindow(post) {
  if (!post?.id) {
    return false;
  }

  const timestamp = post.created_at || post.updated_at;
  if (!timestamp) {
    return false;
  }

  const createdMs = new Date(timestamp).getTime();
  if (Number.isNaN(createdMs)) {
    return false;
  }

  const hoursSince = (Date.now() - createdMs) / (1000 * 60 * 60);
  return hoursSince <= 48;
}
