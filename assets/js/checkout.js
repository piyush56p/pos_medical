const utils = require("./web-utils");

/** CheckOut Functions **/
$(document).ready(function () {
  /**
   * handle keypad button pressed.
   * @param {string} value - The keypad value to be processed.
   * @param {boolean} isDueInput - Indicates whether the input is for due payment.
   */
  $.fn.keypadBtnPressed = function (value, isDueInput) {
    let paymentAmount = $("#payment").val();
    if (isDueInput) {
      $("#refNumber").val($("#refNumber").val() + "" + value);
    } else {
      paymentAmount = paymentAmount + "" + value;
      $("#paymentText").val(utils.moneyFormat(paymentAmount));
      $("#payment").val(paymentAmount);
      $(this).calculateChange();
    }
  };

  /**
   * Format payment amount with commas when a point is pressed
   */
  $.fn.digits = function () {
    let paymentAmount = $("#payment").val();
    $("#paymentText").val(utils.moneyFormat(paymentAmount));
    $("#payment").val(paymentAmount + ".");
    $(this).calculateChange();
  };

  /**
   * Calculate and display the balance due.
   */
  $.fn.calculateChange = function () {
    var payablePrice = $("#payablePrice").val().replace(",", "");
    var payment = $("#payment").val().replace(",", "");
    var change = Math.max(0, Number(payment) - Number(payablePrice));
    $("#change").text(utils.moneyFormat(change.toFixed(2)));
    $("#confirmPayment").toggle(Number(payment) > 0);
  };

  var $keypadBtn = $(".keypad-btn").on("click", function () {
    const key = $(this).data("val");
    const isdue = $(this).data("isdue");
    switch(key)
    {
    case "del" : { 
      if(isdue)
      {
        $('#refNumber').val((i, val) => val.slice(0, -1));
      }
      else
      {
        $("#payment").val((i, val) => val.slice(0, -1));
      //re-format displayed amount after deletion 
      $("#paymentText").val((i, val) => utils.moneyFormat($("#payment").val()));
      }
      $(this).calculateChange()
    }; break;

    case "ac":{
      if(isdue)
      {
          $('#refNumber').val('');
      }
      else
      {
        $('#payment,#paymentText').val('');
        $(this).calculateChange();
      }
       
    };break;

  case "point": {
    $(this).digits()
    };break;

   default: $(this).keypadBtnPressed(key, isdue); break;
  }
});

  /** Switch Views for Payment Options **/
  var $list = $("#paymentMethods .list-group-item").on("click", function (event) {
    event.preventDefault();
    $list.removeClass("active");
    $(this).addClass("active");
    if (this.id == "check") {
      $("#cardInfo").show();
      $("#cardInfo .input-group-addon").text("Check Info");
    } else if (this.id == "card") {
      $("#cardInfo").show();
      $("#cardInfo .input-group-addon").text("Card Info");
    } else {
      $("#cardInfo").hide();
    }
    const isSplit = Number($(this).data("payment-type")) === 4;
    $("#singlePaymentEntry").toggle(!isSplit);
    $("#splitPaymentFields").toggle(isSplit);
    if (isSplit) $(".split-payment-amount").first().trigger("focus");
  });

  $("#paymentModel").on("show.bs.modal", function () {
    $list.removeClass("active");
    $("#cash").addClass("active");
    $("#singlePaymentEntry").show();
    $("#splitPaymentFields").hide();
    $("#splitCashAmount,#splitUpiAmount,#splitCardAmount").val("0");
    $("#splitCardReference").val("");
    $("#payment,#paymentText").val("");
    $("#change").text("0");
  });

  $(".split-payment-amount").on("input", function () {
    const amounts = ["#splitCashAmount", "#splitUpiAmount", "#splitCardAmount"].map((selector) => Number($(selector).val()) || 0);
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const payable = Number($("#payablePrice").val().replace(/,/g, "")) || 0;
    $("#splitPaymentTotal").text(`₹${utils.moneyFormat(total.toFixed(2))}`);
    $("#payment").val(total.toFixed(2));
    $("#paymentText").val(utils.moneyFormat(total.toFixed(2)));
    $("#change").text("0.00");
    $("#confirmPayment").toggle(total > 0 && total <= payable);
  });
});