import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerTier, PlatformRole } from '@prisma/client';

export class AuthTenantSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;
}

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ enum: ['PLATFORM', 'CUSTOMER'] })
  actorType!: 'PLATFORM' | 'CUSTOMER';

  @ApiProperty({ enum: [...Object.values(PlatformRole), 'CUSTOMER'] })
  role!: PlatformRole | 'CUSTOMER';

  @ApiPropertyOptional({ type: String, nullable: true })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  tenantId?: string | null;

  @ApiPropertyOptional({ enum: CustomerTier, nullable: true })
  customerTier?: CustomerTier | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  emailVerifiedAt?: string | null;

  @ApiPropertyOptional({ type: [AuthTenantSummaryDto] })
  ownedTenants?: AuthTenantSummaryDto[];
}

export class AuthSessionResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class VerifyOtpResponseDto {
  @ApiProperty({ example: true })
  verified!: boolean;

  @ApiProperty({ example: 'usuario@ejemplo.com' })
  email!: string;
}

export class AuthMessageResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Si el correo existe, recibirás un código de verificación.' })
  message!: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  loggedOut!: boolean;
}

export class AuthCapabilitiesResponseDto {
  @ApiProperty({ example: false })
  googleEnabled!: boolean;

  @ApiProperty({ enum: ['oauth', 'local-fallback'], example: 'local-fallback' })
  mode!: 'oauth' | 'local-fallback';
}
