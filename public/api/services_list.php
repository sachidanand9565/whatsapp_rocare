<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

error_reporting(0);

// ── DB Config ──────────────────────────────────────────────────
$host     = "localhost";
$db_user  = "your_db_user";
$db_pass  = "your_db_password";
$db_name  = "your_db_name";

$con = mysqli_connect($host, $db_user, $db_pass, $db_name);
if (!$con) {
    echo json_encode(["error" => "true", "msg" => "Database connection failed"]);
    exit();
}
mysqli_set_charset($con, "utf8mb4");

// ── Input ──────────────────────────────────────────────────────
$data        = json_decode(file_get_contents("php://input"));
$lead_type_id = isset($data->lead_type) ? intval($data->lead_type) : 0;
$cid          = isset($data->cid)        ? intval($data->cid)       : 0;

if (!$lead_type_id) {
    echo json_encode(["error" => "true", "msg" => "lead_type is required"]);
    exit();
}

// ── Get service category name ──────────────────────────────────
$name_sql    = "SELECT name FROM lead_types WHERE id = '$lead_type_id' LIMIT 1";
$name_query  = mysqli_query($con, $name_sql);
$name_result = mysqli_fetch_array($name_query);
$servicenm   = $name_result ? $name_result['name'] : "Services";

// ── Fetch services ─────────────────────────────────────────────
$sql   = "SELECT * FROM all_services
          WHERE lead_type_id = '$lead_type_id'
            AND status = '1'
          ORDER BY sr_no_customer_app ASC";
$query = mysqli_query($con, $sql);

$response = ["error" => "false"];

if (mysqli_num_rows($query) > 0) {

    $all = [];

    while ($result = mysqli_fetch_array($query)) {

        $service_id = $result['id'];

        // Clean HTML from description
        $desc = $result['description'];
        $desc = str_replace(["\r\n", "</li>", "</ul>"], '', $desc);
        $desc = strip_tags($desc);

        // Image URL
        $image = $result['image_icon'];
        $image_url = ($image != "")
            ? "https://www.waterpurifierservicecenter.in/inet/img/service_img/" . $image
            : "";

        // Cart quantity for this user
        $quantity = 0;
        if ($cid > 0) {
            $cart_sql    = "SELECT quantity FROM order_details_leads
                            WHERE customer_id = '$cid'
                              AND service_id  = '$service_id'
                              AND status      = '0'
                            LIMIT 1";
            $cart_query  = mysqli_query($con, $cart_sql);
            $cart_result = mysqli_fetch_array($cart_query);
            if ($cart_result) {
                $quantity = intval($cart_result['quantity']);
            }
        }

        $all[] = [
            "id"                   => $result['id'],
            "service_name"         => $result['service_name'],
            "description"          => $desc,
            "price"                => $result['price'],
            "price_without_discount" => $result['price_without_discount'],
            "model_id"             => $result['model_id'],
            "image"                => $image_url,
            "quantity"             => $quantity,
        ];
    }

    $response['error']           = "false";
    $response['Title']           = $servicenm;
    $response['service_details'] = $all;

} else {
    $response['error'] = "true";
    $response['msg']   = "No services found";
}

echo json_encode($response);
mysqli_close($con);
?>
