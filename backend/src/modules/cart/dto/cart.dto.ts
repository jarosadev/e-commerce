import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, Max, Min, IsUUID } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;
}
