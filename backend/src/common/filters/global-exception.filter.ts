import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../cls/cls.types';

const HTTP_STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(@Optional() private readonly cls?: ClsService<AppClsStore>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Error interno del servidor.';
    let errorName = HTTP_STATUS_TITLES[status] ?? 'Internal Server Error';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      errorName = HTTP_STATUS_TITLES[status] ?? exception.name;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        if (typeof body.error === 'string') {
          errorName = body.error;
        }
        if (typeof body.message === 'string' || Array.isArray(body.message)) {
          message = body.message as string | string[];
        }
        if (typeof body.code === 'string') {
          code = body.code;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          errorName = 'Conflict';
          message = 'Ya existe un registro con los datos únicos proporcionados.';
          code = exception.code;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          errorName = 'Not Found';
          message = 'El recurso solicitado no existe.';
          code = exception.code;
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          errorName = 'Bad Request';
          message = 'Referencia inválida hacia un registro relacionado.';
          code = exception.code;
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          errorName = 'Bad Request';
          message = 'Error al procesar la operación de base de datos.';
          code = exception.code;
          break;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      errorName = 'Bad Request';
      message = 'Error de validación en los parámetros de consulta.';
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(`Unhandled non-Error exception: ${String(exception)}`);
    }

    const requestIdHeader = request.headers['x-request-id'];
    const requestId =
      (this.cls?.isActive() ? this.cls.getId() : undefined) ??
      (typeof requestIdHeader === 'string' && requestIdHeader.trim()
        ? requestIdHeader
        : undefined) ??
      randomUUID();

    const path = request.originalUrl || request.url;
    const detail = Array.isArray(message) ? message.join('; ') : message;

    const payload: Record<string, unknown> = {
      type: `https://httpstatuses.com/${status}`,
      title: errorName,
      status,
      detail,
      instance: path,
      statusCode: status,
      error: errorName,
      message,
      path,
      timestamp: new Date().toISOString(),
      requestId,
    };

    if (code) {
      payload.code = code;
    }

    response.status(status).json(payload);
  }
}
