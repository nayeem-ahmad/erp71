export class CreateCounterDto {
  storeId: string;
  name: string;
  counterNumber: number;
}

export class UpdateCounterDto {
  name?: string;
  status?: string;
}
