"use strict";

function getBuildCommit() {
  const sha = String(
    process.env.GIT_SHA ||
      process.env.GITHUB_SHA ||
      process.env.BUILD_SHA ||
      process.env.SOURCE_VERSION ||
      "",
  ).trim();
  return sha || null;
}

function getBuildInfo() {
  const gitSha = getBuildCommit();
  return {
    git_sha: gitSha,
    git_sha_short: gitSha ? gitSha.slice(0, 12) : null,
    version: process.env.APP_VERSION || gitSha || "dev",
  };
}

module.exports = {
  getBuildCommit,
  getBuildInfo,
};
