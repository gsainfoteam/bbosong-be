import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { User } from 'generated/prisma/client';
import {
  ENCRYPTION_PURPOSE,
  EncryptionPurpose,
} from './constants/encryption.constants';

interface EncryptionSecrets {
  ENCRYPTION_PEPPER: string;
}

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private pepper!: string;
  private isInitialized = false;
  private readonly secretName: string;
  private readonly awsRegion: string;
  private readonly kmsKeyId: string;
  private readonly secretsManager: SecretsManagerClient;
  private readonly kmsClient: KMSClient;

  constructor(private readonly configService: ConfigService) {
    const bypass =
      this.configService.get<string>('BYPASS_AWS_ENCRYPTION') === 'true';
    if (bypass) {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new InternalServerErrorException(
          'AWS Encryption bypass is not allowed in production environment.',
        );
      }
      const localKey = this.configService.get<string>('LOCAL_ENCRYPTION_KEY');
      const localPepper = this.configService.get<string>(
        'LOCAL_ENCRYPTION_PEPPER',
      );
      if (!localKey || !localPepper) {
        throw new InternalServerErrorException(
          'Bypass mode requires LOCAL_ENCRYPTION_KEY and LOCAL_ENCRYPTION_PEPPER to be explicitly configured.',
        );
      }
      this.secretName = '';
      this.awsRegion = 'ap-northeast-2';
      this.kmsKeyId = '';
    } else {
      this.secretName = this.configService.getOrThrow<string>(
        'AWS_SECRET_MANAGER_NAME',
      );
      this.awsRegion = this.configService.getOrThrow<string>('AWS_REGION');
      this.kmsKeyId = this.configService.getOrThrow<string>('AWS_KMS_KEY_ID');
    }
    this.secretsManager = new SecretsManagerClient({
      region: this.awsRegion,
    });
    this.kmsClient = new KMSClient({ region: this.awsRegion });
  }

  async onModuleInit() {
    const bypass =
      this.configService.get<string>('BYPASS_AWS_ENCRYPTION') === 'true';
    if (bypass) {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new InternalServerErrorException(
          'AWS Encryption bypass is not allowed in production environment.',
        );
      }
      const localPepper = this.configService.get<string>(
        'LOCAL_ENCRYPTION_PEPPER',
      );
      if (!localPepper) {
        throw new InternalServerErrorException(
          'Bypass mode requires LOCAL_ENCRYPTION_PEPPER to be explicitly configured.',
        );
      }
      this.pepper = localPepper;
      this.isInitialized = true;
      this.logger.log('Bypassed AWS encryption, using local fallback.');
      return;
    }

    try {
      const response = await this.secretsManager.send(
        new GetSecretValueCommand({ SecretId: this.secretName }),
      );

      if (!response.SecretString) throw new Error('SecretString is empty');

      const secrets = JSON.parse(response.SecretString) as EncryptionSecrets;
      if (!secrets.ENCRYPTION_PEPPER) {
        throw new Error('Secret must contain ENCRYPTION_PEPPER');
      }
      this.pepper = secrets.ENCRYPTION_PEPPER;
      this.isInitialized = true;
    } catch (error) {
      this.logger.error('Failed to load encryption secrets from AWS:', error);
      throw new InternalServerErrorException(
        'Failed to initialize encryption service',
      );
    }
  }

  private ensureInitialized() {
    if (!this.isInitialized) {
      throw new InternalServerErrorException(
        'EncryptionService is not initialized',
      );
    }
  }

  async encrypt(
    text: string | null | undefined,
    purpose: EncryptionPurpose,
    uuid: string,
  ): Promise<string | null> {
    if (!text) return text as null;
    this.ensureInitialized();

    const bypass =
      this.configService.get<string>('BYPASS_AWS_ENCRYPTION') === 'true';
    if (bypass) {
      try {
        const localKey = this.configService.get<string>('LOCAL_ENCRYPTION_KEY');
        if (!localKey) {
          throw new InternalServerErrorException(
            'LOCAL_ENCRYPTION_KEY must be explicitly configured in bypass mode.',
          );
        }
        const key = crypto.scryptSync(localKey, this.pepper, 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return iv.toString('base64') + ':' + encrypted;
      } catch (error) {
        this.logger.error('Local encryption failed:', error);
        throw new InternalServerErrorException('Encryption failed');
      }
    }

    try {
      const command = new EncryptCommand({
        KeyId: this.kmsKeyId,
        Plaintext: Buffer.from(text, 'utf8'),
        EncryptionContext: {
          purpose,
          uuid,
        },
      });

      const response = await this.kmsClient.send(command);
      if (!response.CiphertextBlob) {
        throw new Error('KMS encryption failed: No CiphertextBlob returned');
      }

      return Buffer.from(response.CiphertextBlob).toString('base64');
    } catch (error) {
      this.logger.error('KMS encryption failed:', error);
      throw new InternalServerErrorException('Encryption failed');
    }
  }

  async decrypt(
    encryptedData: string | null | undefined,
    purpose: EncryptionPurpose,
    uuid: string,
  ): Promise<string | null> {
    if (!encryptedData) return encryptedData as null;
    this.ensureInitialized();

    const bypass =
      this.configService.get<string>('BYPASS_AWS_ENCRYPTION') === 'true';
    if (bypass) {
      try {
        const parts = encryptedData.split(':');
        if (parts.length !== 2) {
          throw new InternalServerErrorException(
            'Mismatched or malformed local ciphertext: missing IV or ciphertext component.',
          );
        }
        const localKey = this.configService.get<string>('LOCAL_ENCRYPTION_KEY');
        if (!localKey) {
          throw new InternalServerErrorException(
            'LOCAL_ENCRYPTION_KEY must be explicitly configured in bypass mode.',
          );
        }
        const key = crypto.scryptSync(localKey, this.pepper, 32);
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
        return decrypted;
      } catch (error) {
        this.logger.error('Local decryption failed:', error);
        throw new InternalServerErrorException(
          `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    if (encryptedData.includes(':')) {
      throw new InternalServerErrorException(
        'Mismatched encryption mode: local ciphertext format cannot be decrypted in KMS mode.',
      );
    }

    try {
      const command = new DecryptCommand({
        KeyId: this.kmsKeyId,
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
        EncryptionContext: {
          purpose,
          uuid,
        },
      });

      const response = await this.kmsClient.send(command);
      if (!response.Plaintext) {
        throw new Error('KMS decryption failed: No Plaintext returned');
      }

      return Buffer.from(response.Plaintext).toString('utf8');
    } catch (error) {
      this.logger.error('KMS decryption failed:', error);
      throw new InternalServerErrorException(
        `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
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
    const [name, email, phoneNumber, studentNumber] = await Promise.all([
      this.decrypt(user.name, ENCRYPTION_PURPOSE.USER.NAME, user.uuid),
      this.decrypt(user.email, ENCRYPTION_PURPOSE.USER.EMAIL, user.uuid),
      this.decrypt(
        user.phoneNumber,
        ENCRYPTION_PURPOSE.USER.PHONE_NUMBER,
        user.uuid,
      ),
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
      phoneNumber: phoneNumber!,
      studentNumber: studentNumber!,
    };
  }
}
