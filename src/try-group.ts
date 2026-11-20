import { groupTransactions } from "./parse.js";

const rows = [
  { lsn: "0/100", xid: "1", data: "BEGIN 1" },
  { lsn: "0/110", xid: "1", data: "table public.orders: UPDATE: old-key: id[integer]:2 customer[text]:'Dev' status[text]:'pending' total[numeric]:25 new-tuple: id[integer]:2 customer[text]:'Dev' status[text]:'shipped' total[numeric]:25" },
  { lsn: "0/120", xid: "1", data: "COMMIT 1 (at 2026-11-20 02:13:31.975627+00)" },
  { lsn: "0/130", xid: "2", data: "BEGIN 2" },
  { lsn: "0/140", xid: "2", data: "table public.orders: INSERT: id[integer]:4 customer[text]:'Leo' status[text]:'pending' total[numeric]:60" },
  { lsn: "0/150", xid: "2", data: "table public.orders: DELETE: id[integer]:4 customer[text]:'Leo' status[text]:'pending' total[numeric]:60" },
  { lsn: "0/160", xid: "2", data: "COMMIT 2 (at 2026-11-20 02:14:10.100000+00)" },
];

console.log(JSON.stringify(groupTransactions(rows), null, 2));