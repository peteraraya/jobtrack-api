import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaInit1788559449162 implements MigrationInterface {
  name = 'SchemaInit1788559449162';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "application" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "jobOfferId" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'applied', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a103ad6438da65ac2524b7d3f1d" UNIQUE ("userId", "jobOfferId"), CONSTRAINT "PK_569e0c3e863ebdf5f2408ee1670" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_06ff70d67f36b48b66686d0fb4" ON "application"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "company" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "website" character varying(255), "location" character varying(120), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_056f7854a7afdba7cbd6d45fc20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "job_offer" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "companyId" uuid NOT NULL, "title" character varying(120) NOT NULL, "description" text NOT NULL DEFAULT '', "location" character varying(200) NOT NULL DEFAULT '', "stack" text NOT NULL DEFAULT '', "sourceUrl" character varying(500) NOT NULL, "source" character varying(100) NOT NULL, "slots" integer NOT NULL DEFAULT '3', "postedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_0b32e93a519c675de6fde45dce7" UNIQUE ("sourceUrl"), CONSTRAINT "PK_5286026037ab5fb5acfcb7e1829" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db393fc88298505a8ba7a8cc0f" ON "job_offer"  ("postedAt", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notification" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "type" character varying(30) NOT NULL, "payload" jsonb, "readAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_705b6c7cdf9b2c2ff7ac7872cb7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ced25315eb974b73391fb1c81" ON "notification"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "profile" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "stack" text NOT NULL DEFAULT '', "yearsOfExperience" integer NOT NULL DEFAULT '0', "cv" jsonb, CONSTRAINT "UQ_a24972ebd73b106250713dcddd9" UNIQUE ("userId"), CONSTRAINT "REL_a24972ebd73b106250713dcddd" UNIQUE ("userId"), CONSTRAINT "PK_3dd8bfc97e4a77c70971591bdcb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(255) NOT NULL, "passwordHash" character varying(255) NOT NULL, "role" character varying(10) NOT NULL DEFAULT 'user', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "application" ADD CONSTRAINT "FK_b4ae3fea4a24b4be1a86dacf8a2" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "application" ADD CONSTRAINT "FK_10648d47c727ce2a56cca5e0c12" FOREIGN KEY ("jobOfferId") REFERENCES "job_offer"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_offer" ADD CONSTRAINT "FK_edf4833b0e156904893c4e59a7e" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_1ced25315eb974b73391fb1c81b" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile" ADD CONSTRAINT "FK_a24972ebd73b106250713dcddd9" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile" DROP CONSTRAINT "FK_a24972ebd73b106250713dcddd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "FK_1ced25315eb974b73391fb1c81b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_offer" DROP CONSTRAINT "FK_edf4833b0e156904893c4e59a7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application" DROP CONSTRAINT "FK_10648d47c727ce2a56cca5e0c12"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application" DROP CONSTRAINT "FK_b4ae3fea4a24b4be1a86dacf8a2"`,
    );
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TABLE "profile"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ced25315eb974b73391fb1c81"`,
    );
    await queryRunner.query(`DROP TABLE "notification"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db393fc88298505a8ba7a8cc0f"`,
    );
    await queryRunner.query(`DROP TABLE "job_offer"`);
    await queryRunner.query(`DROP TABLE "company"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_06ff70d67f36b48b66686d0fb4"`,
    );
    await queryRunner.query(`DROP TABLE "application"`);
  }
}
