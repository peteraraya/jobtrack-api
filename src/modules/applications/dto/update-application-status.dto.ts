import { z } from 'zod';
import { ApplicationStatus } from '../enums/application-status.enum.js';

export const ApplicationStatusValues = Object.values(ApplicationStatus) as [
  ApplicationStatus,
  ...ApplicationStatus[],
];

export const UpdateApplicationStatusSchema = z
  .object({
    status: z.enum(ApplicationStatusValues),
  })
  .strict();

export class UpdateApplicationStatusDto {
  static schema = UpdateApplicationStatusSchema;

  status: ApplicationStatus;
}
