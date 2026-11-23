import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../cls/cls.types';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    const mockCls = {
      isActive: () => true,
      getId: () => 'req-cls-123',
    } as unknown as ClsService<AppClsStore>;
    filter = new GlobalExceptionFilter(mockCls);

    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({
          method: 'GET',
          url: '/api/v1/test',
          originalUrl: '/api/v1/test',
          headers: {},
        }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('formats validation BadRequestException arrays as RFC 7807', () => {
    const ex = new BadRequestException(['email must be an email', 'password is too short']);
    filter.catch(ex, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'https://httpstatuses.com/400',
        title: 'Bad Request',
        status: 400,
        detail: 'email must be an email; password is too short',
        instance: '/api/v1/test',
        statusCode: 400,
        error: 'Bad Request',
        message: ['email must be an email', 'password is too short'],
        path: '/api/v1/test',
        requestId: 'req-cls-123',
      }),
    );
  });

  it('maps Prisma P2002 to 409 Conflict and P2025 to 404 Not Found', () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    filter.catch(p2002, mockHost);
    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, error: 'Conflict', code: 'P2002' }),
    );

    const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '6.19.3',
    });
    filter.catch(p2025, mockHost);
    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'Not Found', code: 'P2025' }),
    );
  });

  it('maps unknown Error to 500 Internal Server Error without leaking internals', () => {
    const loggerSpy = jest
      .spyOn((filter as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('db password leak'), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Error interno del servidor.',
      }),
    );
    loggerSpy.mockRestore();
  });
});
