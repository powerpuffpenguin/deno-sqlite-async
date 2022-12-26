# deno-sqlite-async

deno sqlite3 async

[English](README.md)

[x/sqlite](https://deno.land/x/sqlite) 是一個 deno 的 sqlite 庫，它使用了
WebAssembly 因此很容器嵌入到不同 os 平臺，然而
[x/sqlite](https://deno.land/x/sqlite) 不支持異步
api，於是我對齊進行了二次開發，將對 [x/sqlite](https://deno.land/x/sqlite)
的調用都放到一個單獨的 web worker 中，而在主線程中以直接以 異步 api 提供接口

# RawDB

class RawDB 是對 [x/sqlite](https://deno.land/x/sqlite)
的異步封裝，如果你想得到一個幾乎和 [x/sqlite](https://deno.land/x/sqlite)
一致但已經封裝好的異步庫則可以使用 RawDB，或者你想對
[x/sqlite](https://deno.land/x/sqlite) 進行異步接口的封裝也可以從 RawDB
開始，否則你應該使用 [class DB](#DB)

RawDB 大部分 api 和 [x/sqlite](https://deno.land/x/sqlite) 類似，不同在於 RawDB
提供了一個 batch 函數用於將多組命令批量傳遞給 web worker 執行用於縮短與 web
worker 通信產生的延遲

# DB

class DB 是在 RawDB 之上建立的一個更完善的庫，如果你只想使用 異步 api 操作
sqlite 不關心其它細節則推薦使用它。

[x/sqlite](https://deno.land/x/sqlite) 受限與 deno api 而不能正確的獲取到 sqlite
的文件鎖，這在某些情況下可能出現 bug。class DB 在底層使用
[x/sqlite](https://deno.land/x/sqlite) 故也存在同樣的問題，但是 class DB
提供了一個可選的讀寫鎖，並且大部分默認操作都進行了加鎖處理，這可以保證在同一個連接中避免無法加鎖引發的
bug
