export function validateSampleId(id: string): boolean {
  return /^sample_[a-z0-9]+$/.test(id);
}
