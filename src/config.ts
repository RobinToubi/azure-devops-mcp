// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export let orgUrl = "";
export let orgName = "";
export let isCustomUrl = false;
export let insecure = false;

export function setConfig(name: string, url: string, custom: boolean, skipTlsVerification = false) {
  orgName = name;
  orgUrl = url;
  isCustomUrl = custom;
  insecure = skipTlsVerification;
}
