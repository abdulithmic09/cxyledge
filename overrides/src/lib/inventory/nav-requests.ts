/** Small hand-offs between screens: "open this bill for editing", "find this cylinder". */
let bill: string | null = null;
let cylinder: string | null = null;

export function requestBillEdit(billNo: string) {
  bill = billNo;
}
export function peekBillRequest() {
  return bill;
}
export function clearBillRequest() {
  bill = null;
}

export function requestCylinder(serial: string) {
  cylinder = serial;
}
export function takeCylinderRequest() {
  const value = cylinder;
  cylinder = null;
  return value;
}
