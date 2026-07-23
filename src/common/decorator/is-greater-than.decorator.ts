import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Define the validation constraint class
@ValidatorConstraint({ name: 'isGreaterThan', async: false })
export class IsGreaterThanConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const constraints = args.constraints as unknown[];
    const relatedPropertyName = constraints[0] as string;
    const object = args.object as Record<string, unknown>;
    const relatedValue = object[relatedPropertyName];

    // Validate if the current value is greater than or equal to the related value
    return (
      typeof value === 'number' &&
      typeof relatedValue === 'number' &&
      value >= relatedValue
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const constraints = args.constraints as unknown[];
    const relatedPropertyName = constraints[0] as string;

    // Return error message if validation fails
    return `${args.property} must be greater than or equal to ${relatedPropertyName}`;
  }
}

// Define the decorator function
export function IsGreaterThan(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsGreaterThanConstraint,
    });
  };
}
