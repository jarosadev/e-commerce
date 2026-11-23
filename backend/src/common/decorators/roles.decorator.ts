import { SetMetadata } from '@nestjs/common';
import { AllowedRole } from '../cls/cls.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AllowedRole[]) => SetMetadata(ROLES_KEY, roles);
