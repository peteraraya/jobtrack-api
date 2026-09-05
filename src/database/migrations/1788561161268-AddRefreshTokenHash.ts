import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenHash1788561161268 implements MigrationInterface {
  name = 'AddRefreshTokenHash1788561161268';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Módulo 4: hash del refresh token rotable (dentro de User en runtime).
    await queryRunner.query(
      `ALTER TABLE "user" ADD "refresh_token_hash" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "refresh_token_hash"`,
    );
  }
}
