import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User } from 'generated/prisma/client';
import {
  ENCRYPTION_PURPOSE,
  EncryptionPurpose,
} from './constants/encryption.constants';

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private pepper!: string;
  private isInitialized = false;
  private derivedKey!: Buffer;

  constructor(private readonly configService: ConfigService) {
    // Validate configuration early
    const localKey = this.configService.get<string>('LOCAL_ENCRYPTION_KEY');
    const localPepper = this.configService.get<string>(
      'LOCAL_ENCRYPTION_PEPPER',
    );
    if (!localKey || !localPepper) {
      throw new InternalServerErrorException(
        'EncryptionService requires LOCAL_ENCRYPTION_KEY and LOCAL_ENCRYPTION_PEPPER to be explicitly configured.',
      );
    }
  }

  onModuleInit() {
    this.pepper = this.configService.getOrThrow<string>(
      'LOCAL_ENCRYPTION_PEPPER',
    );
    const localKey = this.configService.getOrThrow<string>(
      'LOCAL_ENCRYPTION_KEY',
    );
    this.derivedKey = crypto.scryptSync(localKey, this.pepper, 32);
    this.isInitialized = true;
    this.logger.log('EncryptionService initialized using local configuration.');
  }

  private ensureInitialized() {
    if (!this.isInitialized) {
      throw new InternalServerErrorException(
        'EncryptionService is not initialized',
      );
    }
  }

  encrypt(
    text: string | null | undefined,
    _purpose: EncryptionPurpose,
    _uuid: string,
  ): Promise<string | null> {
    if (!text) return Promise.resolve(text as null);
    this.ensureInitialized();

    try {
      const key = this.derivedKey;
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return Promise.resolve(iv.toString('base64') + ':' + encrypted);
    } catch (error) {
      this.logger.error('Local encryption failed:', error);
      throw new InternalServerErrorException('Encryption failed');
    }
  }

  decrypt(
    encryptedData: string | null | undefined,
    _purpose: EncryptionPurpose,
    _uuid: string,
  ): Promise<string | null> {
    if (!encryptedData) return Promise.resolve(encryptedData as null);
    this.ensureInitialized();

    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 2) {
        throw new InternalServerErrorException(
          'Mismatched or malformed local ciphertext: missing IV or ciphertext component.',
        );
      }
      const key = this.derivedKey;
      const iv = Buffer.from(parts[0], 'base64');
      const encryptedText = Buffer.from(parts[1], 'base64');
      if (iv.length !== 16) {
        throw new Error('Invalid IV length');
      }
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([
        decipher.update(encryptedText),
        decipher.final(),
      ]).toString('utf8');
      return Promise.resolve(decrypted);
    } catch (error) {
      this.logger.error('Local decryption failed:', error);
      throw new InternalServerErrorException('Decryption failed');
    }
  }

  hash(studentNumber: string): string {
    this.ensureInitialized();

    return crypto
      .createHmac('sha256', this.pepper)
      .update(studentNumber.trim())
      .digest('hex');
  }

  async decryptUser(user: User): Promise<User> {
    if (!user) return user;
    const [name, email, studentNumber] = await Promise.all([
      // const [name, email, phoneNumber, studentNumber] = await Promise.all([
      this.decrypt(user.name, ENCRYPTION_PURPOSE.USER.NAME, user.uuid),
      this.decrypt(user.email, ENCRYPTION_PURPOSE.USER.EMAIL, user.uuid),
      // this.decrypt(
      //   user.phoneNumber,
      //   ENCRYPTION_PURPOSE.USER.PHONE_NUMBER,
      //   user.uuid,
      // ),
      this.decrypt(
        user.studentNumber,
        ENCRYPTION_PURPOSE.USER.STUDENT_NUMBER,
        user.uuid,
      ),
    ]);
    return {
      ...user,
      name: name!,
      email: email!,
      // phoneNumber: phoneNumber!,
      studentNumber: studentNumber!,
    };
  }
}
