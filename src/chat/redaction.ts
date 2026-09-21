const redactedCredential = "[已隐藏凭据]";

export function redactCredential(message: string, credential: string): string {
  const secret = credential.trim();
  return secret && message.includes(secret)
    ? message.split(secret).join(redactedCredential)
    : message;
}
