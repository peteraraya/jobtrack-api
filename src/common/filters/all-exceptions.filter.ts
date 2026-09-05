import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from '../observability/request-context.js';

interface ErrorBody {
  status: number;
  message: string;
  errors?: unknown[];
}

/** Errores HTTP "de facto" sin ser HttpException (p. ej. 413 del body-parser). */
interface HttpLikeError {
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * @Catch() sin argumentos = captura TODO (cualquier excepción, haya sido o no
 * lanzada por Nest). Dos reglas:
 * 1) El detalle interno (stack trace) SIEMPRE se loguea.
 * 2) El cliente recibe solo información segura; nunca stack traces en
 *    producción (la forma y los mensajes quedan idénticos en dev/test).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body =
      exception instanceof HttpException
        ? this.toHttpBody(exception)
        : (this.toHttpLikeBody(exception) ?? this.toUnknownBody(exception));

    if (exception instanceof HttpException) {
      this.logger.warn(
        `${request.method} ${request.url} [${getRequestId() ?? 'no-request-id'}] -> ${body.status}`,
      );
    } else {
      this.logger.error(
        `${request.method} ${request.url} [${getRequestId() ?? 'no-request-id'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.status).json({
      statusCode: body.status,
      message: body.message,
      ...(body.errors === undefined ? {} : { errors: body.errors }),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private toHttpBody(exception: HttpException): ErrorBody {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { status, message: response };
    }

    if (response && typeof response === 'object') {
      const { message, errors } = response as {
        message?: string | string[];
        errors?: unknown[];
      };

      const finalMessage =
        typeof message === 'string'
          ? message
          : Array.isArray(message)
            ? message.join(', ')
            : exception.message;

      return {
        status,
        message: finalMessage,
        ...(errors === undefined ? {} : { errors }),
      };
    }

    return { status, message: exception.message };
  }

  private toHttpLikeBody(exception: unknown): ErrorBody | null {
    if (!(exception instanceof Error) && typeof exception !== 'object') {
      return null;
    }

    const { status, statusCode, message } = exception as HttpLikeError;
    const numericStatus =
      typeof statusCode === 'number'
        ? statusCode
        : typeof status === 'number'
          ? status
          : null;

    if (numericStatus === null || numericStatus < 400 || numericStatus > 599) {
      return null;
    }

    // p. ej. 413 PayloadTooLargeError del body-parser. Se mantiene el mensaje
    // del framework en dev/test y uno seguro en producción.
    return {
      status: numericStatus,
      message:
        process.env.NODE_ENV === 'production'
          ? 'Request error'
          : (message ?? 'Request error'),
    };
  }

  private toUnknownBody(exception: unknown): ErrorBody {
    const details =
      exception instanceof Error ? exception.message : 'Unknown error';

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      // En producción el cliente solo ve el mensaje genérico.
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : details,
    };
  }
}
