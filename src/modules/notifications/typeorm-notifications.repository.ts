import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { isUuid } from '../../common/utils/is-uuid.js';
import { Notification } from './entities/notification.entity.js';
import { Profile } from '../profiles/entities/profile.entity.js';
import {
  NewNotification,
  NotificationsRepository,
} from './notifications.repository.js';

/**
 * Adaptador TypeORM de NotificationsRepository.
 *
 * `findUsersWithStackMatching` filtra perfiles por stack con LIKE (la columna
 * simple-array de TypeORM es texto CSV, no text[]): es una única query con
 * ORs por término, sin N+1 ni joins innecesarios en este tamaño de dominio.
 */
@Injectable()
export class TypeOrmNotificationsRepository extends NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(Profile)
    private readonly profileRepository: Repository<Profile>,
  ) {
    super();
  }

  override async findAllForUser(userId: string): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  override async findById(id: string): Promise<Notification | null> {
    if (!isUuid(id)) return null;
    return this.notificationRepository.findOneBy({ id });
  }

  override async createForUsers(
    notifications: NewNotification[],
  ): Promise<Notification[]> {
    const entities = notifications.map((n) =>
      this.notificationRepository.create({
        userId: n.userId,
        type: n.type,
        payload: n.payload ?? null,
      }),
    );
    return this.notificationRepository.save(entities);
  }

  override async findUsersWithStackMatching(
    stack: string[],
  ): Promise<string[]> {
    const terms = stack.map((s) => s.trim()).filter((s) => s.length > 0);
    if (terms.length === 0) return [];

    const rows = await this.profileRepository
      .createQueryBuilder('p')
      .select('p.userId', 'userId')
      .where(
        new Brackets((qb) => {
          terms.forEach((term, index) => {
            const clause = `p.stack LIKE :term${index}`;
            if (index === 0) {
              qb.where(clause, { [`term${index}`]: `%${term}%` });
            } else {
              qb.orWhere(clause, { [`term${index}`]: `%${term}%` });
            }
          });
        }),
      )
      .getRawMany<{ userId: string }>();

    return [...new Set(rows.map((row) => row.userId))];
  }

  override async markAsRead(
    id: string,
    userId: string,
  ): Promise<Notification | null> {
    if (!isUuid(id)) return null;
    const notification = await this.notificationRepository.findOneBy({
      id,
      userId,
    });
    if (!notification) return null;
    notification.readAt = new Date();
    return this.notificationRepository.save(notification);
  }

  override async countUnreadForUser(userId: string): Promise<number> {
    return this.notificationRepository.countBy({
      userId,
      readAt: IsNull(),
    });
  }
}
