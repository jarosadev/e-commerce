import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @ApiProperty({ example: 'dueno@mitienda.com' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'SecretPass123!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'María González' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio.' })
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'dueno@mitienda.com' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'SecretPass123!' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: 'Token opcional de carrito de invitado para fusionar al iniciar sesión',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  guestCartToken?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'dueno@mitienda.com' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @Transform(trimString)
  @IsString()
  @Length(6, 6, { message: 'El código OTP debe tener exactamente 6 dígitos.' })
  @Matches(/^\d{6}$/, { message: 'El código OTP debe contener 6 dígitos numéricos.' })
  otp!: string;
}

export class EmailOnlyDto {
  @ApiProperty({ example: 'dueno@mitienda.com' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'dueno@mitienda.com' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @Transform(trimString)
  @IsString()
  @Length(6, 6, { message: 'El código OTP debe tener exactamente 6 dígitos.' })
  @Matches(/^\d{6}$/, { message: 'El código OTP debe contener 6 dígitos numéricos.' })
  otp!: string;

  @ApiProperty({ example: 'NewSecretPass456!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128)
  newPassword!: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Refresh token alternativo si no se envía por cookie HttpOnly',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}

export class GoogleAuthQueryDto {
  @ApiPropertyOptional({ enum: ['platform', 'store'], default: 'platform' })
  @IsOptional()
  @IsIn(['platform', 'store'])
  scope?: 'platform' | 'store';

  @ApiPropertyOptional({ example: 'localhost:3000' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  returnHost?: string;

  @ApiPropertyOptional({ example: 'moda-mayorista' })
  @IsOptional()
  @Transform(trimLower)
  @IsString()
  @MaxLength(63)
  tenantSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  guestCartToken?: string;
}

export class GoogleCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  error?: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ description: 'Código efímero de un solo uso emitido por el broker Google OAuth' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'El código de intercambio es obligatorio.' })
  @MaxLength(512)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  guestCartToken?: string;
}
