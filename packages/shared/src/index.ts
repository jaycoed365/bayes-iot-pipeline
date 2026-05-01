// Shape of the webhook payload from Notehub (or our simulator).
export interface NotehubEvent {
  device: string;
  when: number;
  file: string;
  body: EnvReadingBody;
}

export interface EnvReadingBody {
  temp_c: number;
  humidity: number;
  pressure_hpa?: number;
  voc_ohms?: number;
}
