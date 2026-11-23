import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AuthenticatedUserContext,
  RequestWithContext,
  ResolvedTenantContext,
} from '../../common/cls/cls.types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireTenant, SkipTenantStatus } from '../../common/decorators/require-tenant.decorator';
import { AuthService } from './auth.service';
import {
  EmailOnlyDto,
  GoogleAuthQueryDto,
  GoogleCallbackQueryDto,
  GoogleExchangeDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth-requests.dto';
import {
  AuthCapabilitiesResponseDto,
  AuthMessageResponseDto,
  AuthSessionResponseDto,
  AuthUserDto,
  LogoutResponseDto,
  VerifyOtpResponseDto,
} from './dto/auth-responses.dto';
import { GoogleOAuthService } from './google-oauth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
  ) {}

  @Get('capabilities')
  @Public()
  @SkipTenantStatus()
  @ApiOperation({
    summary: 'Capacidades de autenticación habilitadas (Google OAuth o fallback local)',
  })
  @ApiOkResponse({ type: AuthCapabilitiesResponseDto })
  getCapabilities(): AuthCapabilitiesResponseDto {
    return this.googleOAuthService.getCapabilities();
  }

  // ===========================================================================
  // PLATFORM AUTH
  // ===========================================================================

  @Post('platform/register')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registro de dueño de tienda (PlatformUser) con OTP por correo' })
  @ApiCreatedResponse({ type: AuthUserDto })
  registerPlatform(@Body() dto: RegisterDto): Promise<AuthUserDto> {
    return this.authService.registerPlatform(dto);
  }

  @Post('platform/verify-otp')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica código OTP de 6 dígitos para usuario de plataforma' })
  @ApiOkResponse({ type: VerifyOtpResponseDto })
  verifyPlatformOtp(@Body() dto: VerifyOtpDto): Promise<VerifyOtpResponseDto> {
    return this.authService.verifyPlatformOtp(dto);
  }

  @Post('platform/resend-otp')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenvía código OTP de verificación para usuario de plataforma' })
  @ApiOkResponse({ type: AuthMessageResponseDto })
  resendPlatformOtp(@Body() dto: EmailOnlyDto): Promise<AuthMessageResponseDto> {
    return this.authService.resendPlatformOtp(dto);
  }

  @Post('platform/login')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicio de sesión de usuario de plataforma con cookies HttpOnly' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  loginPlatform(
    @Body() dto: LoginDto,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    return this.authService.loginPlatform(dto, res, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Post('platform/forgot-password')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicita código OTP de recuperación de contraseña de plataforma' })
  @ApiOkResponse({ type: AuthMessageResponseDto })
  forgotPlatformPassword(@Body() dto: EmailOnlyDto): Promise<AuthMessageResponseDto> {
    return this.authService.forgotPlatformPassword(dto);
  }

  @Post('platform/reset-password')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablece la contraseña de plataforma validando código OTP' })
  @ApiOkResponse({ type: AuthMessageResponseDto })
  resetPlatformPassword(@Body() dto: ResetPasswordDto): Promise<AuthMessageResponseDto> {
    return this.authService.resetPlatformPassword(dto);
  }

  // ===========================================================================
  // STORE CUSTOMER AUTH (TENANT-SCOPED)
  // ===========================================================================

  @Post('store/register')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registro de cliente en una tienda específica (StoreCustomer)' })
  @ApiHeader({ name: 'x-tenant-slug', required: false })
  @ApiCreatedResponse({ type: AuthUserDto })
  registerStoreCustomer(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @Body() dto: RegisterDto,
  ): Promise<AuthUserDto> {
    return this.authService.registerStoreCustomer(tenant, dto);
  }

  @Post('store/verify-otp')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica código OTP de 6 dígitos para cliente de tienda' })
  @ApiHeader({ name: 'x-tenant-slug', required: false })
  @ApiOkResponse({ type: VerifyOtpResponseDto })
  verifyStoreCustomerOtp(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @Body() dto: VerifyOtpDto,
  ): Promise<VerifyOtpResponseDto> {
    return this.authService.verifyStoreCustomerOtp(tenant, dto);
  }

  @Post('store/resend-otp')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenvía código OTP de verificación para cliente de tienda' })
  @ApiHeader({ name: 'x-tenant-slug', required: false })
  @ApiOkResponse({ type: AuthMessageResponseDto })
  resendStoreCustomerOtp(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @Body() dto: EmailOnlyDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.resendStoreCustomerOtp(tenant, dto);
  }

  @Post('store/login')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicio de sesión de cliente de tienda con cookies HttpOnly' })
  @ApiHeader({ name: 'x-tenant-slug', required: false })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  loginStoreCustomer(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @Body() dto: LoginDto,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    return this.authService.loginStoreCustomer(tenant, dto, req, res);
  }

  @Post('store/forgot-password')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicita código OTP de recuperación de contraseña en tienda' })
  @ApiHeader({ name: 'x-tenant-slug', required: false })
  @ApiOkResponse({ type: AuthMessageResponseDto })
  forgotStoreCustomerPassword(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @Body() dto: EmailOnlyDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.forgotStoreCustomerPassword(tenant, dto);
  }

  @Post('store/reset-password')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablece la contraseña de cliente de tienda validando OTP' })
  @ApiHeader({ name: 'x-tenant-slug', required: false })
  @ApiOkResponse({ type: AuthMessageResponseDto })
  resetStoreCustomerPassword(
    @CurrentTenant() tenant: ResolvedTenantContext,
    @Body() dto: ResetPasswordDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.resetStoreCustomerPassword(tenant, dto);
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  @Post('refresh')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotación atómica de Refresh Token con detección de reuso' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  refresh(
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: RefreshTokenDto,
  ): Promise<AuthSessionResponseDto> {
    return this.authService.refreshTokens(req, res, dto);
  }

  @Post('logout')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cierra sesión revocando familia de tokens y limpiando cookies' })
  @ApiOkResponse({ type: LogoutResponseDto })
  logout(
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: RefreshTokenDto,
  ): Promise<LogoutResponseDto> {
    return this.authService.logout(req, res, dto);
  }

  @Get('me')
  @SkipTenantStatus()
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Retorna perfil actualizado y sanitizado de la sesión activa' })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentUser() user: AuthenticatedUserContext): Promise<AuthUserDto> {
    return this.authService.getMe(user);
  }

  // ===========================================================================
  // CENTRAL GOOGLE OAUTH 2.0 BROKER
  // ===========================================================================

  @Get('google')
  @Public()
  @SkipTenantStatus()
  @ApiOperation({ summary: 'Inicia flujo Google OAuth 2.0 o redirige al fallback local' })
  async startGoogleAuth(@Query() query: GoogleAuthQueryDto, @Res() res: Response): Promise<void> {
    const redirectUrl = await this.googleOAuthService.buildAuthorizationOrFallbackUrl(query);
    res.redirect(HttpStatus.FOUND, redirectUrl);
  }

  @Get('google/callback')
  @Public()
  @SkipTenantStatus()
  @ApiOperation({ summary: 'Callback central de Google OAuth 2.0' })
  async googleCallback(
    @Query() query: GoogleCallbackQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const redirectUrl = await this.googleOAuthService.handleCallback(query);
    res.redirect(HttpStatus.FOUND, redirectUrl);
  }

  @Post('google/exchange')
  @Public()
  @SkipTenantStatus()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Intercambia código efímero OAuth por cookies HttpOnly de sesión' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  exchangeGoogleCode(
    @Body() dto: GoogleExchangeDto,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    return this.googleOAuthService.exchangeOneTimeCode(dto, req, res);
  }
}
