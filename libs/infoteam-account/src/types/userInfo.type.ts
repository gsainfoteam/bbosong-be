import { Gender } from 'generated/prisma/enums';

export type UserInfo = {
  email: string;
  name: string;
  studentNumber: string;
};

export type UserInfoWithGender = {
  email: string;
  name: string;
  studentNumber: string;
  gender: Gender;
  // phoneNumber: string;
};
